import type { AppConfig, OrchestrationConfig } from '../config/types.js';
import type { AgentType } from '../agents/types.js';
import type { LayoutManager } from '../screen/layout-manager.js';
import type { AgentLifecycleEvent, AgentManager, RunningAgentInfo } from '../agents/agent-manager.js';
import type { TerminalPanel } from '../panels/terminal-panel.js';
import { buildProtocolInstructions, type CommanderMessage, type MessageType } from './protocol.js';
import {
  MessageLedger,
  type PendingReplyRoute,
  type SessionRef,
} from './message-ledger.js';
import { showToast } from '../screen/toast.js';
import { logger } from '../utils/logger.js';
import blessed from 'blessed';

interface TaskSourceRef {
  panel: number;
  sessionId: string;
  agent: string;
  agentType: AgentType;
}

interface QueuedTask {
  id: number;
  agentType: AgentType;
  task: string;
  source?: TaskSourceRef;
  /** When true, type directly to Claude (no bracketed paste = no bypass prompt). */
  directType?: boolean;
  kind?: MessageType;
  messageId?: string;
  threadId?: string;
  replyToMessageId?: string | null;
  claimedReplyRoute?: PendingReplyRoute | null;
  skipAck?: boolean;
  onComplete?: (result: { success: boolean; error?: string }) => void;
  started: boolean;
  cancelled: boolean;
  queuedAt: number;
}

interface PanelQueueState {
  tasks: QueuedTask[];
  processing: boolean;
  currentTask: QueuedTask | null;
  detachedReason: string | null;
}

interface ProtocolSessionState {
  injectedAt: number;
  engaged: boolean;
  lastUserInputAt: number;
}

const CLAUDE_DIRECT_TYPE_MAX_CHARS = 320;
const CLAUDE_DIRECT_SUBMIT_DELAY_MS = 120;

/**
 * Orchestrator — handles both manual (Ctrl+O) and automatic (inter-agent)
 * task routing between agent panels.
 *
 * Supported protocol commands:
 *   SEND:agent:panel — direct message to a specific agent
 *   REPLY            — continue the latest open thread for this session
 *   BROADCAST        — send to all connected agents
 *   STATUS           — display progress in Commander UI
 *   QUERY            — ask Commander for environment info
 *
 * Tasks targeting the same panel are queued and processed sequentially
 * to prevent interleaved input from concurrent senders.
 *
 * Muting strategy:
 *   Avoid muting during normal routing so fast protocol replies are not lost.
 *   Instead, pre-mark echoed protocol blocks before sending text that contains
 *   markers (for example templates containing SEND/REPLY examples).
 */
export class Orchestrator {
  private connectedPanels = new Set<number>();
  /** Panels that have had protocol instructions injected. */
  private protocolInjected = new Set<number>();
  /** Per-panel task queues to prevent concurrent sends to the same agent. */
  private panelQueues = new Map<number, PanelQueueState>();
  private panelProcessing = new Set<number>();
  private nextTaskId = 1;
  /** Grace period after protocol injection — ignore non-SEND messages from this panel. */
  private injectionGrace = new Map<number, number>();
  /** Tracks whether a freshly injected session has been explicitly engaged yet. */
  private protocolSessionState = new Map<string, ProtocolSessionState>();
  private ledger = new MessageLedger();
  private orchConfig: OrchestrationConfig;

  constructor(
    private layout: LayoutManager,
    private agentManager: AgentManager,
    private screen?: blessed.Widgets.Screen,
    config?: AppConfig,
  ) {
    this.orchConfig = {
      gridScanDelay: 200,
      injectionGrace: 2500,
      initDelay: 3000,
      claudeSubmitDelay: 2500,
      ackTimeout: 60000,
      dedupWindow: 15000,
      maxContentLines: 500,
      ...config?.orchestration,
    };

    if (typeof this.agentManager.onLifecycle === 'function') {
      this.agentManager.onLifecycle((event) => {
        this.handleAgentLifecycle(event);
      });
    }
  }

  // ── Panel monitoring ──────────────────────────────────────────

  /** Connect to a terminal panel so we receive its inter-agent messages. */
  connectPanel(tp: TerminalPanel): void {
    const isNew = !this.connectedPanels.has(tp.panelIndex);
    this.connectedPanels.add(tp.panelIndex);
    tp.updatePanelIndex(tp.panelIndex);

    // Always (re-)set the callback — the TerminalPanel instance may have
    // been recreated (e.g. after a file↔terminal conversion) even though
    // the panel index stayed the same.
    tp.onCommanderMessage = (msg: CommanderMessage) => {
      this.handleAgentMessage(msg);
    };
    tp.onUserInput = () => {
      this.markPanelUserEngaged(tp.panelIndex);
    };

    if (isNew) {
      logger.info(`Orchestrator: monitoring panel ${tp.panelIndex} for inter-agent messages`);
    }
  }

  /** Disconnect monitoring when a panel is destroyed. */
  disconnectPanel(panelIndex: number): void {
    const sessionId = this.agentManager.getAgentSessionId(panelIndex);
    this.connectedPanels.delete(panelIndex);
    this.protocolInjected.delete(panelIndex);
    const queueState = this.panelQueues.get(panelIndex);
    if (queueState) {
      this.failPendingTasks(queueState, `Panel ${panelIndex + 1} is no longer available`);
      queueState.detachedReason = `Panel ${panelIndex + 1} is no longer available`;
      this.panelQueues.delete(panelIndex);
    }
    this.syncPanelProcessing();
    this.injectionGrace.delete(panelIndex);
    this.scrubSourceReferences(panelIndex);
    if (sessionId) {
      this.ledger.closeSession(sessionId);
      this.protocolSessionState.delete(sessionId);
    }
    // Null out the callback on the terminal panel to prevent stale routing
    const tp = this.layout.getTerminalPanel(panelIndex);
    if (tp) {
      tp.onCommanderMessage = null;
      tp.onUserInput = null;
    }
  }

  reindexAfterPanelRemoval(removedPanelIndex: number): void {
    const shiftPanelIndex = (panelIndex: number): number => (
      panelIndex > removedPanelIndex ? panelIndex - 1 : panelIndex
    );

    const removedQueue = this.panelQueues.get(removedPanelIndex);
    if (removedQueue) {
      this.failPendingTasks(removedQueue, `Panel ${removedPanelIndex + 1} was removed`);
      removedQueue.detachedReason = `Panel ${removedPanelIndex + 1} was removed`;
    }

    this.connectedPanels = new Set(
      [...this.connectedPanels]
        .filter((panelIndex) => panelIndex !== removedPanelIndex)
        .map(shiftPanelIndex),
    );

    this.protocolInjected = new Set(
      [...this.protocolInjected]
        .filter((panelIndex) => panelIndex !== removedPanelIndex)
        .map(shiftPanelIndex),
    );

    const reindexedQueues = new Map<number, PanelQueueState>();
    for (const [panelIndex, queueState] of this.panelQueues) {
      if (panelIndex === removedPanelIndex) continue;
      this.remapQueueSources(queueState, removedPanelIndex);
      reindexedQueues.set(shiftPanelIndex(panelIndex), queueState);
    }
    this.panelQueues = reindexedQueues;
    this.syncPanelProcessing();

    const reindexedGrace = new Map<number, number>();
    for (const [panelIndex, graceEnd] of this.injectionGrace) {
      if (panelIndex === removedPanelIndex) continue;
      reindexedGrace.set(shiftPanelIndex(panelIndex), graceEnd);
    }
    this.injectionGrace = reindexedGrace;

  }

  resetState(): void {
    for (const queueState of this.panelQueues.values()) {
      this.failPendingTasks(queueState, 'Orchestration state was reset');
      queueState.detachedReason = 'Orchestration state was reset';
    }
    for (let i = 0; i < this.layout.panelCount; i++) {
      const tp = this.layout.getTerminalPanel(i);
      if (tp) {
        tp.onCommanderMessage = null;
        tp.onUserInput = null;
      }
    }
    this.connectedPanels.clear();
    this.protocolInjected.clear();
    this.panelQueues.clear();
    this.panelProcessing.clear();
    this.injectionGrace.clear();
    this.protocolSessionState.clear();
    for (const agent of this.agentManager.getRunningAgents()) {
      this.ledger.closeSession(agent.sessionId);
    }
  }

  private handleAgentLifecycle(event: AgentLifecycleEvent): void {
    if (event.previousSessionId) {
      this.ledger.closeSession(event.previousSessionId);
      this.protocolSessionState.delete(event.previousSessionId);
    }

    if (event.type === 'exited') {
      this.ledger.closeSession(event.sessionId);
      this.protocolSessionState.delete(event.sessionId);
    }

    this.protocolInjected.delete(event.panelIndex);
    this.injectionGrace.delete(event.panelIndex);
  }

  private findRunningAgent(panelIndex: number): RunningAgentInfo | null {
    if (typeof this.agentManager.getRunningAgents !== 'function') return null;
    return this.agentManager.getRunningAgents().find((agent) => agent.panelIndex === panelIndex) ?? null;
  }

  private resolveSessionRefForPanel(panelIndex: number): SessionRef | null {
    const running = this.findRunningAgent(panelIndex);
    if (!running) return null;
    return {
      sessionId: running.sessionId,
      panelIndex: running.panelIndex,
      agentName: running.name,
      agentType: running.type,
    };
  }

  private resolveMessageSource(msg: CommanderMessage): SessionRef | null {
    const running = this.findRunningAgent(msg.sourcePanel);
    if (running) {
      return {
        sessionId: running.sessionId,
        panelIndex: running.panelIndex,
        agentName: running.name,
        agentType: running.type,
      };
    }

    const fallbackType = this.agentManager.getAgentType(msg.sourcePanel);
    if (!fallbackType) return null;

    const sessionId = this.agentManager.getAgentSessionId(msg.sourcePanel);
    if (!sessionId) return null;

    return {
      sessionId,
      panelIndex: msg.sourcePanel,
      agentName: msg.sourceAgent,
      agentType: fallbackType,
    };
  }

  private getStartupGuardMs(): number {
    return Math.max(30000, this.orchConfig.dedupWindow * 2);
  }

  private markSessionEngaged(sessionId: string): void {
    const state = this.protocolSessionState.get(sessionId);
    if (state) {
      state.engaged = true;
    }
  }

  private markPanelUserEngaged(panelIndex: number): void {
    const sessionId = this.agentManager.getAgentSessionId(panelIndex);
    if (!sessionId) return;
    const state = this.protocolSessionState.get(sessionId);
    if (!state) return;
    state.engaged = true;
    state.lastUserInputAt = Date.now();
  }

  private shouldSuppressStartupMessage(source: SessionRef, msg: CommanderMessage): boolean {
    const state = this.protocolSessionState.get(source.sessionId);
    if (!state || state.engaged) return false;
    if (Date.now() - state.injectedAt > this.getStartupGuardMs()) return false;

    if (msg.type === 'reply') {
      return false;
    }

    if (msg.type === 'query') {
      const query = msg.content.toLowerCase().trim();
      if (query === 'agents' || query === 'list' || query === 'list agents' || query === 'panels' || query === 'help' || query === 'commands' || query === 'ping') {
        this.markSessionEngaged(source.sessionId);
        return false;
      }
      logger.info(`Orchestrator: suppressed startup QUERY from panel ${source.panelIndex + 1}: ${query}`);
      return true;
    }

    logger.info(`Orchestrator: suppressed unsolicited startup ${msg.type.toUpperCase()} from panel ${source.panelIndex + 1}`);
    return true;
  }

  private formatForwardedMessage(
    source: SessionRef,
    messageId: string,
    threadId: string,
    content: string,
  ): string {
    return `[From ${source.agentName} in Panel ${source.panelIndex + 1} | thread=${threadId} | msg=${messageId}]: ${content}`;
  }

  private formatBroadcastMessage(
    source: SessionRef,
    messageId: string,
    threadId: string,
    content: string,
  ): string {
    return `[Broadcast from ${source.agentName} in Panel ${source.panelIndex + 1} | thread=${threadId} | msg=${messageId}]: ${content}`;
  }

  private isSourceSessionStillActive(source: TaskSourceRef): boolean {
    return this.agentManager.getAgentSessionId(source.panel) === source.sessionId;
  }

  // ── Inter-agent message handling ──────────────────────────────

  private handleAgentMessage(msg: CommanderMessage): void {
    switch (msg.type) {
      case 'send':
        this.handleSend(msg);
        break;
      case 'reply':
        this.handleReply(msg);
        break;
      case 'broadcast':
        this.handleBroadcast(msg);
        break;
      case 'status':
        this.handleStatus(msg);
        break;
      case 'query':
        this.handleQuery(msg);
        break;
      default:
        logger.warn(`Orchestrator: unknown message type: ${(msg as any).type}`);
    }
  }

  // ── SEND — direct message to a specific agent ──────────────────

  private handleSend(msg: CommanderMessage): void {
    const source = this.resolveMessageSource(msg);
    if (!source) {
      logger.warn(`Orchestrator: SEND from panel ${msg.sourcePanel} but source session is unavailable`);
      return;
    }
    if (this.shouldSuppressStartupMessage(source, msg)) return;
    this.markSessionEngaged(source.sessionId);

    const targetAgentInfo = this.findRunningAgent(msg.targetPanel);
    const targetName = targetAgentInfo?.name ?? msg.targetAgent;
    const record = this.ledger.createMessage({
      kind: 'send',
      source,
      target: {
        sessionId: targetAgentInfo?.sessionId ?? null,
        panelIndex: msg.targetPanel,
        agentName: targetName,
        agentType: msg.targetAgent,
      },
      content: msg.content,
    });

    logger.info(
      `Orchestrator: SEND from ${msg.sourceAgent} (panel ${msg.sourcePanel}) ` +
      `→ ${msg.targetAgent} (panel ${msg.targetPanel + 1}) [${record.threadId}/${record.messageId}]: ${msg.content.slice(0, 80)}…`,
    );

    const prefixed = this.formatForwardedMessage(source, record.messageId, record.threadId, msg.content);

    this.enqueueTask(msg.targetPanel, {
      agentType: msg.targetAgent,
      task: prefixed,
      source: {
        panel: source.panelIndex,
        sessionId: source.sessionId,
        agent: source.agentName,
        agentType: source.agentType,
      },
      directType: true,
      kind: 'send',
      messageId: record.messageId,
      threadId: record.threadId,
      });
  }

  // ── REPLY — continue the latest open thread for this session ──

  private handleReply(msg: CommanderMessage): void {
    const source = this.resolveMessageSource(msg);
    if (!source) {
      logger.warn(`Orchestrator: REPLY from panel ${msg.sourcePanel} but source session is unavailable`);
      return;
    }
    this.markSessionEngaged(source.sessionId);

    const replyRoute = this.ledger.claimReplyWindow(source.sessionId);
    if (!replyRoute) {
      logger.warn(`Orchestrator: REPLY from panel ${msg.sourcePanel} but no open reply thread — dropped`);
      return;
    }

    const returnPanel = this.agentManager.findPanelBySessionId(replyRoute.returnToSessionId);
    if (returnPanel === null) {
      logger.warn(
        `Orchestrator: REPLY from panel ${msg.sourcePanel} but return session ${replyRoute.returnToSessionId} is gone`,
      );
      return;
    }

    const targetInfo = this.findRunningAgent(returnPanel);
    const targetAgentType = targetInfo?.type ?? replyRoute.returnToAgentType;
    const targetAgentName = targetInfo?.name ?? replyRoute.returnToAgentName;

    const record = this.ledger.createMessage({
      kind: 'reply',
      source,
      target: {
        sessionId: targetInfo?.sessionId ?? replyRoute.returnToSessionId,
        panelIndex: returnPanel,
        agentName: targetAgentName,
        agentType: targetAgentType,
      },
      content: msg.content,
      threadId: replyRoute.threadId,
      replyToMessageId: replyRoute.replyToMessageId,
    });

    logger.info(
      `Orchestrator: REPLY from ${msg.sourceAgent} (panel ${msg.sourcePanel}) ` +
      `→ ${targetAgentName} (panel ${returnPanel}) [${record.threadId}/${record.messageId}]: ${msg.content.slice(0, 80)}…`,
    );

    const prefixed = this.formatForwardedMessage(source, record.messageId, record.threadId, msg.content);

    this.enqueueTask(returnPanel, {
      agentType: targetAgentType,
      task: prefixed,
      source: {
        panel: source.panelIndex,
        sessionId: source.sessionId,
        agent: source.agentName,
        agentType: source.agentType,
      },
      directType: true,
      kind: 'reply',
      messageId: record.messageId,
      threadId: record.threadId,
      replyToMessageId: record.replyToMessageId,
      claimedReplyRoute: replyRoute,
    });
  }

  // ── BROADCAST — send to all connected agents ───────────────────

  private handleBroadcast(msg: CommanderMessage): void {
    const source = this.resolveMessageSource(msg);
    if (!source) {
      logger.warn(`Orchestrator: BROADCAST from panel ${msg.sourcePanel} but source session is unavailable`);
      return;
    }
    if (this.shouldSuppressStartupMessage(source, msg)) return;
    this.markSessionEngaged(source.sessionId);

    const targets = [...this.connectedPanels].filter((p) => p !== msg.sourcePanel);
    logger.info(
      `Orchestrator: BROADCAST from ${msg.sourceAgent} (panel ${msg.sourcePanel}) ` +
      `→ ${targets.length} panels: ${msg.content.slice(0, 80)}…`,
    );

    if (targets.length === 0) {
      logger.warn(`Orchestrator: BROADCAST from panel ${msg.sourcePanel} but no other agents — dropped`);
      return;
    }

    const queuedFor: string[] = [];

    for (const panelIndex of targets) {
      const targetInfo = this.findRunningAgent(panelIndex);
      const agentType = targetInfo?.type ?? this.agentManager.getAgentType(panelIndex);
      if (!agentType) continue;

      const record = this.ledger.createMessage({
        kind: 'broadcast',
        source,
        target: {
          sessionId: targetInfo?.sessionId ?? null,
          panelIndex,
          agentName: targetInfo?.name ?? agentType,
          agentType,
        },
        content: msg.content,
      });

      const prefixed = this.formatBroadcastMessage(source, record.messageId, record.threadId, msg.content);
      this.enqueueTask(panelIndex, {
        agentType,
        task: prefixed,
        source: {
          panel: source.panelIndex,
          sessionId: source.sessionId,
          agent: source.agentName,
          agentType: source.agentType,
        },
        directType: true,
        kind: 'broadcast',
        messageId: record.messageId,
        threadId: record.threadId,
        skipAck: true,
      });

      queuedFor.push(`${targetInfo?.name ?? agentType} in Panel ${panelIndex + 1}`);
    }

    if (queuedFor.length > 0) {
      const ack = `[Commander ACK] kind=broadcast queued=${queuedFor.length} targets=${queuedFor.join(', ')}`;
      this.sendInfoToPanel(msg.sourcePanel, ack);
    }
  }

  // ── STATUS — show progress in Commander UI ─────────────────────

  private handleStatus(msg: CommanderMessage): void {
    const source = this.resolveMessageSource(msg);
    if (!source) {
      logger.warn(`Orchestrator: STATUS from panel ${msg.sourcePanel} but source session is unavailable`);
      return;
    }
    if (this.shouldSuppressStartupMessage(source, msg)) return;
    this.markSessionEngaged(source.sessionId);

    const statusText = `${msg.sourceAgent} [P${msg.sourcePanel + 1}]: ${msg.content}`;
    logger.info(`Orchestrator: STATUS — ${statusText}`);

    if (this.screen) {
      showToast(this.screen, statusText, 3000);
    }

    const ackSummary = msg.content.replace(/\s+/g, ' ').trim().replace(/"/g, '\'').slice(0, 140);
    this.sendInfoToPanel(
      msg.sourcePanel,
      `[Commander ACK] kind=status status=accepted text="${ackSummary}"`,
    );
  }

  // ── QUERY — respond with environment info ──────────────────────

  private handleQuery(msg: CommanderMessage): void {
    const source = this.resolveMessageSource(msg);
    if (!source) {
      logger.warn(`Orchestrator: QUERY from panel ${msg.sourcePanel} but source session is unavailable`);
      return;
    }
    if (this.shouldSuppressStartupMessage(source, msg)) return;

    const query = msg.content.toLowerCase().trim();
    logger.info(`Orchestrator: QUERY from panel ${msg.sourcePanel}: ${query}`);

    let response: string;

    if (query === 'agents' || query === 'list' || query === 'list agents') {
      const agents = this.agentManager.getRunningAgents();
      if (agents.length === 0) {
        response = '[Commander] No agents currently running.';
      } else {
        const lines = agents.map((a) =>
          `  Panel ${a.panelIndex + 1}: ${a.name} (${a.type}) — running (uptime: ${a.uptime}s)`);
        response = `[Commander] Running agents:\n${lines.join('\n')}`;
      }
    } else if (query === 'panels') {
      const info: string[] = [];
      for (let i = 0; i < this.layout.panelCount; i++) {
        const tp = this.layout.getTerminalPanel(i);
        const agent = this.agentManager.getAgentType(i);
        if (tp && agent) {
          info.push(`  Panel ${i + 1}: ${agent} (${tp.isRunning ? 'running' : 'stopped'})`);
        } else if (tp) {
          info.push(`  Panel ${i + 1}: terminal (no agent)`);
        } else {
          info.push(`  Panel ${i + 1}: file browser`);
        }
      }
      response = `[Commander] Panel layout (${this.layout.panelCount} panels):\n${info.join('\n')}`;
    } else if (query === 'status') {
      const myAgent = this.agentManager.getRunningAgents().find((a) => a.panelIndex === msg.sourcePanel);
      const uptime = myAgent ? 'running' : 'unknown';
      response = `[Commander] Status for ${msg.sourceAgent} [Panel ${msg.sourcePanel + 1}]: ${uptime}`;
    } else if (query === 'help' || query === 'commands') {
      response = [
        '[Commander] Available protocol commands:',
        '  SEND:<type>:<panel> — direct message',
        '  REPLY               — continue your latest open thread',
        '  BROADCAST           — send to all connected agents',
        '  STATUS              — display progress in UI',
        '  QUERY               — ask for info (agents, panels, status, help, ping)',
      ].join('\n');
    } else if (query === 'ping') {
      response = '[Commander] PONG';
    } else {
      response = `[Commander] Unknown query "${query}". Available queries: agents, panels, status, help, ping`;
    }

    this.sendInfoToPanel(msg.sourcePanel, response);
    this.markSessionEngaged(source.sessionId);
  }

  // ── Panel messaging helpers ─────────────────────────────────────

  /**
   * Send an ACK or NACK back to the source panel so the sender knows
   * whether its message was delivered successfully.
   */
  private sendAck(
    sourcePanelIndex: number,
    targetAgent: string,
    targetPanel: number,
    success: boolean,
    messageId?: string,
    threadId?: string,
    error?: string,
  ): void {
    const ack = success
      ? `[Commander ACK] status=delivered msg=${messageId ?? 'n/a'} thread=${threadId ?? 'n/a'} target="${targetAgent}" panel=${targetPanel + 1}`
      : `[Commander ACK] status=failed msg=${messageId ?? 'n/a'} thread=${threadId ?? 'n/a'} target="${targetAgent}" panel=${targetPanel + 1} error="${error ?? 'unknown error'}"`;
    this.sendInfoToPanel(sourcePanelIndex, ack);
  }

  /**
   * Send an informational message to a panel (ACK, NACK, QUERY response, etc.).
   *
   * Claude Code: typed directly (NO bracketed paste) to avoid the
   * "bypass permissions" prompt.  Multi-line text is flattened.
   * Other agents: bracketed paste for atomic multi-line delivery.
   */
  private sendInfoToPanel(panelIndex: number, text: string): void {
    const tp = this.layout.getTerminalPanel(panelIndex);
    if (!tp?.isRunning) return;

    const agentType = this.agentManager.getAgentType(panelIndex);

    if (agentType === 'claude') {
      // Type directly — no bracketed paste = no bypass permissions prompt.
      // Flatten newlines so \n doesn't get misinterpreted by Ink.
      // Truncate to terminal width to prevent line-wrap ghost artifacts:
      // when Claude's Ink TUI redraws, it doesn't clear wrapped overflow
      // rows from injected text, leaving ghost characters on screen.
      const flat = text.replace(/\n/g, ' ');
      const maxCols = tp.cols ?? 120;
      const trimmed = flat.length > maxCols - 2 ? flat.slice(0, maxCols - 5) + '...' : flat;
      tp.sendInput(trimmed + '\r');
    } else {
      // Single atomic write — prevents garbled output from concurrent sends.
      tp.sendInput(`\x1b[200~${text}\x1b[201~\r`);
    }

    logger.info(`Orchestrator: info → panel ${panelIndex}: ${text.slice(0, 100)}`);
  }

  // ── Send protocol instructions to an agent ────────────────────

  /**
   * Inject Commander protocol instructions into a running agent.
   * Call this after an agent has initialised.
   */
  async injectProtocol(tp: TerminalPanel): Promise<void> {
    if (!tp.isRunning) return;

    const myAgent = this.agentManager.getAgentType(tp.panelIndex);
    if (!myAgent) return;

    const myInfo = this.agentManager.getRunningAgents().find(
      (a) => a.panelIndex === tp.panelIndex,
    );

    const others = this.agentManager.getRunningAgents()
      .filter((a) => a.panelIndex !== tp.panelIndex)
      .map((a) => ({ name: a.name, type: a.type, panel: a.panelIndex }));

    const instructions = buildProtocolInstructions(
      tp.panelIndex,
      myInfo?.name ?? myAgent,
      others,
    );

    try {
      tp.markProtocolTextAsProcessed(instructions);
      await this.sendTextToAgent(tp, instructions);
      await this.submitInput(tp);
      await this.delay(this.orchConfig.gridScanDelay);
      tp.snapshotVisibleProtocolAsProcessed();
      this.protocolInjected.add(tp.panelIndex);
      const sessionId = this.agentManager.getAgentSessionId(tp.panelIndex);
      if (sessionId) {
        this.protocolSessionState.set(sessionId, {
          injectedAt: Date.now(),
          engaged: false,
          lastUserInputAt: 0,
        });
      }
      this.injectionGrace.delete(tp.panelIndex);
      logger.info(`Orchestrator: injected protocol instructions to panel ${tp.panelIndex}`);
    } catch (err) {
      logger.error(`Orchestrator: protocol injection failed for panel ${tp.panelIndex}`, err);
    }
  }

  // ── Task queue ──────────────────────────────────────────────────

  private enqueueTask(
    panelIndex: number,
    task: Omit<QueuedTask, 'id' | 'started' | 'cancelled' | 'queuedAt'>,
  ): QueuedTask {
    const queueState = this.getOrCreateQueue(panelIndex);
    const queuedTask: QueuedTask = {
      ...task,
      id: this.nextTaskId++,
      started: false,
      cancelled: false,
      queuedAt: Date.now(),
    };
    queueState.tasks.push(queuedTask);
    logger.info(`Orchestrator: queued task for panel ${panelIndex} (queue depth: ${queueState.tasks.length})`);

    if (!queueState.processing) {
      void this.processQueue(queueState);
    }

    return queuedTask;
  }

  private async processQueue(queueState: PanelQueueState): Promise<void> {
    if (queueState.processing) return;
    queueState.processing = true;
    this.syncPanelProcessing();

    try {
      while (true) {
        if (queueState.detachedReason) break;
        const panelIndex = this.findQueuePanelIndex(queueState);
        if (panelIndex === null || queueState.tasks.length === 0) break;

        const task = queueState.tasks.shift()!;
        if (task.cancelled) continue;

        // Warn if task was stuck in queue for long
        const waitTime = Date.now() - task.queuedAt;
        if (waitTime > 10000) {
          logger.warn(`Orchestrator: task ${task.id} for panel ${(panelIndex ?? -1) + 1} was stuck in queue for ${waitTime}ms`);
        }

        task.started = true;
        queueState.currentTask = task;
        let result: { success: boolean; error?: string };
        try {
          result = await this.executeTask(task.agentType, panelIndex, task.task, task.directType);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          result = { success: false, error };
          logger.error(`Orchestrator: executeTask threw for panel ${panelIndex}`, err);
        }

        const currentPanelIndex = this.findQueuePanelIndex(queueState);
        if (queueState.detachedReason && currentPanelIndex === null) {
          result = { success: false, error: queueState.detachedReason };
        }

        try {
          task.onComplete?.(result);
        } catch (err) {
          logger.error(`Orchestrator: task completion callback failed for panel ${currentPanelIndex ?? panelIndex}`, err);
        }

        const effectivePanelIndex = currentPanelIndex ?? panelIndex;
        const deliveredTarget = result.success
          ? this.resolveSessionRefForPanel(effectivePanelIndex)
          : null;
        if (result.success && deliveredTarget) {
          this.markSessionEngaged(deliveredTarget.sessionId);
          this.injectionGrace.delete(effectivePanelIndex);
        }
        if (task.messageId) {
          if (result.success) {
            this.ledger.markDelivered(task.messageId, deliveredTarget ?? undefined);
            if (
              task.source &&
              this.isSourceSessionStillActive(task.source) &&
              deliveredTarget &&
              task.kind !== 'status' &&
              task.kind !== 'query'
            ) {
              this.ledger.openReplyWindow({
                threadId: task.threadId ?? this.ledger.getMessage(task.messageId)?.threadId ?? 'unknown',
                replyToMessageId: task.messageId,
                waitingOnSessionId: deliveredTarget.sessionId,
                returnToSessionId: task.source.sessionId,
                returnToAgentName: task.source.agent,
                returnToAgentType: task.source.agentType,
              });
            }
          } else {
            this.ledger.markFailed(task.messageId, result.error ?? 'unknown error');
            if (task.claimedReplyRoute) {
              this.ledger.restoreReplyWindow(task.claimedReplyRoute);
            }
          }
        } else if (!result.success && task.claimedReplyRoute) {
          this.ledger.restoreReplyWindow(task.claimedReplyRoute);
        }

        if (task.source && this.isSourceSessionStillActive(task.source) && !task.skipAck) {
          const targetInfo = this.findRunningAgent(effectivePanelIndex);
          const targetName = targetInfo?.name ?? task.agentType;

          this.sendAck(
            task.source.panel,
            targetName,
            effectivePanelIndex,
            result.success,
            task.messageId,
            task.threadId,
            result.error,
          );

          if (!result.success) {
            logger.error(`Orchestrator: failed to route message to panel ${effectivePanelIndex}: ${result.error}`);
          }
        }

        queueState.currentTask = null;
      }
    } finally {
      queueState.currentTask = null;
      queueState.processing = false;
      const panelIndex = this.findQueuePanelIndex(queueState);
      if (panelIndex !== null && queueState.tasks.length === 0 && !queueState.detachedReason) {
        this.panelQueues.delete(panelIndex);
      }
      this.syncPanelProcessing();
    }
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Send a task to an agent panel. Tasks targeting the same panel are
   * queued and processed sequentially to prevent interleaved input.
   */
  async sendTask(
    agentType: AgentType,
    panelIndex: number,
    task: string,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let queuedTask: QueuedTask | null = null;
      const timeout = setTimeout(() => {
        if (settled) return;
        const removed = queuedTask ? this.cancelQueuedTask(queuedTask.id) : false;
        settled = true;
        resolve(removed
          ? { success: false, error: `Task queue timed out after ${this.orchConfig.ackTimeout}ms` }
          : { success: false, error: `Task is still in progress after ${this.orchConfig.ackTimeout}ms` });
      }, this.orchConfig.ackTimeout);

      queuedTask = this.enqueueTask(panelIndex, {
        agentType,
        task,
        onComplete: (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        },
      });
    });
  }

  // ── Task execution (internal) ──────────────────────────────────

  private async executeTask(
    agentType: AgentType,
    panelIndex: number,
    task: string,
    directType?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    // 1. Ensure we have enough panels
    while (this.layout.panelCount <= panelIndex) {
      const added = await this.layout.addPanel();
      if (!added) {
        return { success: false, error: `Cannot create panel ${panelIndex + 1} (max 4)` };
      }
    }

    // 2. Convert to terminal if it's a file panel
    let tp = this.layout.getTerminalPanel(panelIndex);
    if (!tp) {
      tp = this.layout.convertToTerminal(panelIndex);
    }

    // 3. Launch agent if not running or different agent
    const currentAgent = this.agentManager.getAgentType(panelIndex);
    const needsLaunch = !tp.isRunning || currentAgent !== agentType;

    if (needsLaunch) {
      if (tp.isRunning) {
        // Kill managed agent or raw terminal session
        if (currentAgent) {
          this.agentManager.killAgent(panelIndex);
        } else {
          tp.killAgent(true);
        }
        await this.delay(300);
      }

      this.protocolInjected.delete(panelIndex);
      const ok = this.agentManager.launchAgent(agentType, tp);
      if (!ok) {
        return { success: false, error: `Failed to launch ${agentType}` };
      }

      // Connect monitoring
      this.connectPanel(tp);

      logger.info(`Orchestrator: launched ${agentType} on panel ${panelIndex}, waiting for init…`);
      await this.delay(this.orchConfig.initDelay);

      // Protocol injection is manual only (Ctrl+P). Do NOT auto-inject here —
      // it floods the agent with text while it's still initializing and causes
      // unwanted message queueing (e.g. Codex's "submitted after next tool call").
    }

    // 4. Ensure panel is connected for inter-agent message detection
    this.connectPanel(tp);

    // 5-6. Send the task text.
    //    Claude Code: short single-line tasks can still be typed directly to
    //    avoid the "bypass permissions" prompt, but longer routed replies are
    //    more reliable via bracketed paste + delayed submit.
    //    Other agents / manual sends: bracketed paste preserves formatting.
    const currentAgentType = this.agentManager.getAgentType(panelIndex);
    tp.reserveProtocolTextForEcho(task);
    if (currentAgentType === 'claude' && this.shouldDirectTypeToClaude(task, directType)) {
      const flat = task.replace(/\n/g, ' ');
      await this.sendTextChunked(tp, flat);
      await this.delay(CLAUDE_DIRECT_SUBMIT_DELAY_MS);
      tp.sendInput('\r');
      tp.showCommanderActivity('Commander task received');
      logger.info(`Orchestrator: typed short task directly to Claude on panel ${panelIndex} (${task.length} chars)`);
    } else {
      await this.sendTextToAgent(tp, task);
      await this.submitInput(tp);
      tp.showCommanderActivity('Commander task received');
      logger.info(
        `Orchestrator: sent task to ${agentType} on panel ${panelIndex} (${task.length} chars)` +
        `${currentAgentType === 'claude' && directType ? ' using paste fallback' : ''}`,
      );
    }

    // 7. Focus the target panel
    this.layout.setActivePanel(panelIndex);

    return { success: true };
  }

  /**
   * Send Enter/submit to an agent after sending text.
   *
   * In a PTY, Enter is `\r` (0x0d).
   *
   * Claude Code shows a "bypass permissions" prompt after bracketed paste.
   * The Enter MUST arrive in a separate PTY read — if it's still in the
   * buffer when Claude reads the paste, it gets processed before the prompt
   * renders and is swallowed.  A 5-second delay ensures Claude has read the
   * paste, rendered the prompt, and is waiting for input before `\r` arrives.
   */
  private async submitInput(tp: TerminalPanel): Promise<void> {
    const agentType = this.agentManager.getAgentType(tp.panelIndex);
    if (agentType === 'claude') {
      // Delay so the paste is read + bypass prompt rendered before \r.
      // The prompt appears within 1-2s; 2.5s gives comfortable margin.
      await this.delay(this.orchConfig.claudeSubmitDelay);
      tp.sendInput('\r');
    } else {
      await this.delay(100);
      tp.sendInput('\r');
    }
  }

  /**
   * Send text wrapped in bracketed-paste escape sequences so that TUI agents
   * treat the entire block as pasted text and insert it verbatim — preserving
   * spaces, punctuation, and newlines.
   *
   * All agents use bracketed paste.  Without it, newlines trigger submission
   * in Claude Code (Ink treats both \r and \n as Enter) and the text is
   * split into fragments.
   */
  private async sendTextToAgent(tp: TerminalPanel, text: string): Promise<void> {
    tp.sendInput('\x1b[200~');
    await this.sendTextChunked(tp, text);
    tp.sendInput('\x1b[201~');
  }

  /**
   * Send text in chunks to avoid PTY input buffer overflows.
   * 1024 bytes stays within the PTY line discipline buffer on all platforms
   * (macOS MAX_INPUT=1024 in non-canonical mode, Linux=4096).
   */
  private async sendTextChunked(tp: TerminalPanel, text: string): Promise<void> {
    const CHUNK_SIZE = 1024;
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      tp.sendInput(text.slice(i, i + CHUNK_SIZE));
      if (i + CHUNK_SIZE < text.length) {
        await this.delay(15);
      }
    }
  }

  private shouldDirectTypeToClaude(task: string, directType?: boolean): boolean {
    if (!directType) return false;
    if (task.includes('\n')) return false;
    return task.length <= CLAUDE_DIRECT_TYPE_MAX_CHARS;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getOrCreateQueue(panelIndex: number): PanelQueueState {
    const existing = this.panelQueues.get(panelIndex);
    if (existing) return existing;

    const queueState: PanelQueueState = {
      tasks: [],
      processing: false,
      currentTask: null,
      detachedReason: null,
    };
    this.panelQueues.set(panelIndex, queueState);
    return queueState;
  }

  private findQueuePanelIndex(queueState: PanelQueueState): number | null {
    for (const [panelIndex, candidate] of this.panelQueues) {
      if (candidate === queueState) return panelIndex;
    }
    return null;
  }

  private syncPanelProcessing(): void {
    this.panelProcessing = new Set(
      [...this.panelQueues.entries()]
        .filter(([, queueState]) => queueState.processing)
        .map(([panelIndex]) => panelIndex),
    );
  }

  private cancelQueuedTask(taskId: number): boolean {
    for (const queueState of this.panelQueues.values()) {
      const taskIndex = queueState.tasks.findIndex((task) => task.id === taskId);
      if (taskIndex === -1) continue;
      const [task] = queueState.tasks.splice(taskIndex, 1);
      task.cancelled = true;
      if (task.messageId) {
        this.ledger.markFailed(task.messageId, 'Task was cancelled before delivery', 'timed_out');
      }
      if (task.claimedReplyRoute) {
        this.ledger.restoreReplyWindow(task.claimedReplyRoute);
      }
      return true;
    }
    return false;
  }

  private failPendingTasks(queueState: PanelQueueState, error: string): void {
    const pendingTasks = queueState.tasks.splice(0);
    for (const task of pendingTasks) {
      if (task.cancelled) continue;
      task.cancelled = true;
      if (task.messageId) {
        this.ledger.markFailed(task.messageId, error, 'dropped');
      }
      if (task.claimedReplyRoute) {
        this.ledger.restoreReplyWindow(task.claimedReplyRoute);
      }
      try {
        task.onComplete?.({ success: false, error });
      } catch (err) {
        logger.error('Orchestrator: failed to settle queued task during teardown', err);
      }
    }
  }

  private remapQueueSources(queueState: PanelQueueState, removedPanelIndex: number): void {
    const remapTask = (task: QueuedTask, allowFailure: boolean): QueuedTask | null => {
      if (!task.source) return task;
      if (task.source.panel === removedPanelIndex) {
        if (allowFailure) {
          task.cancelled = true;
          if (task.messageId) {
            this.ledger.markFailed(task.messageId, 'Source panel was removed', 'dropped');
          }
          if (task.claimedReplyRoute) {
            this.ledger.restoreReplyWindow(task.claimedReplyRoute);
          }
          try {
            task.onComplete?.({ success: false, error: 'Source panel was removed' });
          } catch (err) {
            logger.error('Orchestrator: failed to settle task after source panel removal', err);
          }
          return null;
        }
        task.source = undefined;
        return task;
      }
      if (task.source.panel > removedPanelIndex) {
        task.source = {
          ...task.source,
          panel: task.source.panel - 1,
        };
      }
      return task;
    };

    queueState.tasks = queueState.tasks
      .map((task) => remapTask(task, true))
      .filter((task): task is QueuedTask => task !== null);

    if (queueState.currentTask) {
      queueState.currentTask = remapTask(queueState.currentTask, false);
    }
  }

  private scrubSourceReferences(panelIndex: number): void {
    for (const queueState of this.panelQueues.values()) {
      queueState.tasks = queueState.tasks.filter((task) => {
        if (task.source?.panel !== panelIndex) return true;
        task.cancelled = true;
        if (task.messageId) {
          this.ledger.markFailed(task.messageId, `Source panel ${panelIndex + 1} is no longer available`, 'dropped');
        }
        if (task.claimedReplyRoute) {
          this.ledger.restoreReplyWindow(task.claimedReplyRoute);
        }
        try {
          task.onComplete?.({ success: false, error: `Source panel ${panelIndex + 1} is no longer available` });
        } catch (err) {
          logger.error('Orchestrator: failed to settle task after source disconnect', err);
        }
        return false;
      });
      if (queueState.currentTask?.source?.panel === panelIndex) {
        queueState.currentTask.source = undefined;
      }
    }
  }
}
