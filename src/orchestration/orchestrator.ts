import type { AppConfig, OrchestrationConfig } from '../config/types.js';
import type { AgentType } from '../agents/types.js';
import type { LayoutManager } from '../screen/layout-manager.js';
import type { AgentLifecycleEvent, AgentManager, RunningAgentInfo } from '../agents/agent-manager.js';
import type { TerminalPanel } from '../panels/terminal-panel.js';
import {
  bindTemplateProtocolCapability,
  buildProtocolInstructions,
  generateProtocolCapability,
  hasLegacyProtocolMarkers,
  isProtocolCapability,
  type CommanderMessage,
  type MessageType,
} from './protocol.js';
import {
  MessageLedger,
  type MessageRecord,
  type PendingReplyRoute,
  type SessionRef,
} from './message-ledger.js';
import { showToast } from '../screen/toast.js';
import { logger } from '../utils/logger.js';
import blessed from 'blessed';
import {
  detectCodexDecision,
  type CodexDecisionAction,
} from '../hardware/codex-decision.js';

interface TaskSourceRef {
  panel: number;
  sessionId: string;
  agent: string;
  agentType: AgentType;
}

interface QueuedTask {
  id: number;
  agentType: AgentType;
  profileId?: string;
  task: string;
  source?: TaskSourceRef;
  /** When true, type directly to Claude (no bracketed paste = no bypass prompt). */
  directType?: boolean;
  /** Automatic protocol traffic must never create, convert, or replace a target. */
  allowTargetMutation?: boolean;
  /** Bind trusted collaboration-template markers inside the target session lane. */
  bindTemplateCapability?: boolean;
  /** Exact panel/session state this task was authorized or resolved against. */
  targetExpectation?: TaskTargetExpectation;
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
  retained: boolean;
  retainedBytes: number;
  queuePanelIndex: number;
}

type EnqueueResult =
  | { accepted: true; task: QueuedTask }
  | { accepted: false; error: string };

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

interface ManagedTaskTarget {
  panelIndex: number;
  terminal: TerminalPanel;
  sessionId: string;
  agentType: AgentType;
  profileId: string;
}

/**
 * Immutable snapshot of a task target at routing/confirmation time. Queued
 * work may act only on this exact live session, or on a panel that was idle
 * and remains idle. This prevents stale consent from applying to a session
 * that arrived while another task was ahead in the panel queue.
 */
export type TaskTargetExpectation =
  | {
      panelIndex: number;
      state: 'managed';
      terminal: TerminalPanel | null;
      sessionId: string;
      agentType: AgentType;
      profileId: string;
    }
  | {
      panelIndex: number;
      state: 'unmanaged';
      terminal: TerminalPanel;
      sessionName: string | null;
      sessionGeneration: number;
    }
  | {
      panelIndex: number;
      state: 'idle';
      panel: object;
    };

export interface PreparedTemplateTask {
  content: string;
  bindProtocolCapability: boolean;
}

export interface GuardedCodexDecision {
  action: CodexDecisionAction;
  /** Exact managed session confirmed by the user. */
  sessionId: string;
  /** Exact PTY generation displayed during confirmation. */
  sessionGeneration: number;
  /** All PTY input writes captured before confirmation. */
  inputGeneration: bigint;
  /** SHA-256 fingerprint of the complete visible grid during confirmation. */
  fingerprint: string;
  /** Revalidate a short-lived trusted input origin inside the session lane. */
  validateOrigin?: () => boolean;
}

const CLAUDE_DIRECT_TYPE_MAX_CHARS = 320;
const CLAUDE_DIRECT_SUBMIT_DELAY_MS = 120;

/**
 * Routed-task retention limits. Counts include the task currently being
 * delivered, because its content remains resident until delivery settles.
 */
export const ROUTED_QUEUE_MAX_TASKS_PER_PANEL = 64;
export const ROUTED_QUEUE_MAX_TASKS_GLOBAL = 512;
export const ROUTED_QUEUE_MAX_BYTES_PER_PANEL = 512 * 1024;
export const ROUTED_QUEUE_MAX_BYTES_GLOBAL = 4 * 1024 * 1024;

/**
 * Orchestrator — handles both manual (Ctrl+O) and automatic (inter-agent)
 * task routing between agent panels.
 *
 * Supported protocol commands:
 *   SEND:agent:panel — direct message to a specific agent
 *   REPLY            — continue the latest open thread for this session
 *   BROADCAST        — send to all other connected agents
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
  /** Session-bound authorization; absence means protocol output is inert. */
  private protocolCapabilities = new Map<string, string>();
  /** One Commander-generated input lane per managed session. */
  private inputLaneTails = new Map<string, Promise<void>>();
  /** Per-panel task queues to prevent concurrent sends to the same agent. */
  private panelQueues = new Map<number, PanelQueueState>();
  private panelProcessing = new Set<number>();
  private nextTaskId = 1;
  private retainedTaskCount = 0;
  private retainedTaskBytes = 0;
  private retainedTaskCountByPanel = new Map<number, number>();
  private retainedTaskBytesByPanel = new Map<number, number>();
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
      maxContentBytes: 262144,
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
      this.handlePanelAgentMessage(tp, msg);
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
      this.protocolCapabilities.delete(sessionId);
    }
    // Null out the callback on the terminal panel to prevent stale routing
    const tp = this.layout.getTerminalPanel(panelIndex);
    if (tp) {
      tp.onCommanderMessage = null;
      tp.onUserInput = null;
    }
  }

  handlePanelRemoval(removedPanelId: number): void {
    this.disconnectPanel(removedPanelId);
  }

  /** @deprecated Panel IDs are stable; use handlePanelRemoval. */
  reindexAfterPanelRemoval(removedPanelId: number): void {
    this.handlePanelRemoval(removedPanelId);
  }

  resetState(): void {
    for (const queueState of this.panelQueues.values()) {
      this.failPendingTasks(queueState, 'Orchestration state was reset');
      queueState.detachedReason = 'Orchestration state was reset';
    }
    for (const panel of this.layout.allPanels) {
      const panelId = panel.panelIndex;
      const tp = this.layout.getTerminalPanel(panelId);
      if (tp) {
        tp.onCommanderMessage = null;
        tp.onUserInput = null;
      }
    }
    this.connectedPanels.clear();
    this.protocolInjected.clear();
    this.protocolCapabilities.clear();
    this.inputLaneTails.clear();
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
      this.protocolCapabilities.delete(event.previousSessionId);
    }

    if (event.type === 'exited') {
      this.ledger.closeSession(event.sessionId);
      this.protocolSessionState.delete(event.sessionId);
      this.protocolCapabilities.delete(event.sessionId);
    }

    this.protocolInjected.delete(event.panelIndex);
    this.injectionGrace.delete(event.panelIndex);
  }

  private findRunningAgent(panelIndex: number): RunningAgentInfo | null {
    if (typeof this.agentManager.getRunningAgents !== 'function') return null;
    return this.agentManager.getRunningAgents().find((agent) => agent.panelIndex === panelIndex) ?? null;
  }

  /** Capture the exact target state that a user confirms or a route resolves. */
  captureTaskTarget(panelIndex: number): TaskTargetExpectation | null {
    if (
      typeof this.layout.hasPanel === 'function'
      && !this.layout.hasPanel(panelIndex)
    ) return null;

    const terminal = typeof this.layout.getTerminalPanel === 'function'
      ? this.layout.getTerminalPanel(panelIndex)
      : null;
    const panel = typeof this.layout.getPanel === 'function'
      ? this.layout.getPanel(panelIndex)
      : terminal;
    const running = this.findRunningAgent(panelIndex);
    if (running) {
      const profileId = running.profileId
        ?? (typeof this.agentManager.getAgentProfileId === 'function'
          ? this.agentManager.getAgentProfileId(panelIndex)
          : null)
        ?? running.type;
      return {
        panelIndex,
        state: 'managed',
        terminal,
        sessionId: running.sessionId,
        agentType: running.type,
        profileId,
      };
    }

    if (terminal?.isRunning) {
      return {
        panelIndex,
        state: 'unmanaged',
        terminal,
        sessionName: terminal.sessionName,
        sessionGeneration: terminal.sessionGeneration,
      };
    }

    if (!panel) return null;
    return { panelIndex, state: 'idle', panel };
  }

  private isTaskTargetExpectationCurrent(expectation: TaskTargetExpectation): boolean {
    if (expectation.panelIndex < 0 || !this.layout.hasPanel(expectation.panelIndex)) return false;

    const terminal = this.layout.getTerminalPanel(expectation.panelIndex);
    const running = this.findRunningAgent(expectation.panelIndex);
    if (expectation.state === 'managed') {
      if (!running) return false;
      if (expectation.terminal && terminal !== expectation.terminal) return false;
      const profileId = running.profileId
        ?? (typeof this.agentManager.getAgentProfileId === 'function'
          ? this.agentManager.getAgentProfileId(expectation.panelIndex)
          : null)
        ?? running.type;
      return running.sessionId === expectation.sessionId
        && running.type === expectation.agentType
        && profileId === expectation.profileId;
    }

    if (expectation.state === 'unmanaged') {
      return !running
        && terminal === expectation.terminal
        && terminal.isRunning
        && terminal.sessionName === expectation.sessionName
        && terminal.sessionGeneration === expectation.sessionGeneration;
    }

    return this.layout.getPanel(expectation.panelIndex) === expectation.panel
      && !running
      && !terminal?.isRunning;
  }

  private targetExpectationUnavailable(
    expectation: TaskTargetExpectation,
  ): { success: false; error: string } {
    return this.layout.hasPanel(expectation.panelIndex)
      ? {
          success: false,
          error: `Panel ${expectation.panelIndex + 1} session changed after the task was authorized`,
        }
      : this.targetUnavailable(expectation.panelIndex);
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
      logger.info(
        `Orchestrator: suppressed startup QUERY from panel ${source.panelIndex + 1} ` +
        `(${Buffer.byteLength(msg.content, 'utf8')} payload bytes)`,
      );
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

  /**
   * Production entry point for parsed terminal output. A parser may recognize
   * legacy markers for display compatibility, but routing remains inert until
   * the current managed session has been explicitly armed with its capability.
   */
  private handlePanelAgentMessage(tp: TerminalPanel, msg: CommanderMessage): void {
    if (msg.sourcePanel !== tp.panelIndex || !this.isCurrentTarget(tp.panelIndex, tp)) return;
    const sessionId = this.agentManager.getAgentSessionId(tp.panelIndex);
    const expectedCapability = sessionId
      ? this.protocolCapabilities.get(sessionId)
      : undefined;
    if (
      !sessionId
      || !this.protocolInjected.has(tp.panelIndex)
      || !expectedCapability
      || msg.capability !== expectedCapability
    ) {
      logger.warn(
        `Orchestrator: ignored unarmed or unauthorized protocol output from panel ${tp.panelIndex + 1}`,
      );
      return;
    }
    this.handleAgentMessage(msg);
  }

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
    const targetExpectation = this.captureTaskTarget(msg.targetPanel);
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
      `→ ${msg.targetAgent} (panel ${msg.targetPanel + 1}) [${record.threadId}/${record.messageId}] ` +
      `(${Buffer.byteLength(msg.content, 'utf8')} payload bytes)`,
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
      allowTargetMutation: false,
      ...(targetExpectation ? { targetExpectation } : {}),
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
    const targetExpectation = this.captureTaskTarget(returnPanel);
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
      `→ ${targetAgentName} (panel ${returnPanel}) [${record.threadId}/${record.messageId}] ` +
      `(${Buffer.byteLength(msg.content, 'utf8')} payload bytes)`,
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
      allowTargetMutation: false,
      ...(targetExpectation ? { targetExpectation } : {}),
      kind: 'reply',
      messageId: record.messageId,
      threadId: record.threadId,
      replyToMessageId: record.replyToMessageId,
      claimedReplyRoute: replyRoute,
    });
  }

  // ── BROADCAST — send to all other connected agents ─────────────

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
      `→ ${targets.length} panels (${Buffer.byteLength(msg.content, 'utf8')} payload bytes)`,
    );

    if (targets.length === 0) {
      logger.warn(`Orchestrator: BROADCAST from panel ${msg.sourcePanel} but no other agents — dropped`);
      return;
    }

    const queuedFor: string[] = [];
    const rejectedFor: string[] = [];
    let firstRejection: string | null = null;

    for (const panelIndex of targets) {
      const targetInfo = this.findRunningAgent(panelIndex);
      const targetExpectation = this.captureTaskTarget(panelIndex);
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
      const admission = this.enqueueTask(panelIndex, {
        agentType,
        task: prefixed,
        source: {
          panel: source.panelIndex,
          sessionId: source.sessionId,
          agent: source.agentName,
          agentType: source.agentType,
        },
        directType: true,
        allowTargetMutation: false,
        ...(targetExpectation ? { targetExpectation } : {}),
        kind: 'broadcast',
        messageId: record.messageId,
        threadId: record.threadId,
        skipAck: true,
      });

      const targetLabel = `${targetInfo?.name ?? agentType} in Panel ${panelIndex + 1}`;
      if (admission.accepted) {
        queuedFor.push(targetLabel);
      } else {
        rejectedFor.push(targetLabel);
        firstRejection ??= admission.error;
      }
    }

    if (queuedFor.length > 0 || rejectedFor.length > 0) {
      const ack = rejectedFor.length === 0
        ? `[Commander ACK] kind=broadcast queued=${queuedFor.length} targets=${queuedFor.join(', ')}`
        : `[Commander ACK] kind=broadcast status=${queuedFor.length > 0 ? 'partial' : 'failed'} `
          + `queued=${queuedFor.length} rejected=${rejectedFor.length} `
          + `targets=${queuedFor.join(', ') || 'none'} rejectedTargets=${rejectedFor.join(', ')} `
          + `error="${firstRejection ?? 'Routing queue capacity exceeded'}"`;
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
    logger.info(
      `Orchestrator: STATUS from ${msg.sourceAgent} (panel ${msg.sourcePanel}) ` +
      `(${Buffer.byteLength(msg.content, 'utf8')} payload bytes)`,
    );

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
    logger.info(
      `Orchestrator: QUERY from panel ${msg.sourcePanel} ` +
      `(${Buffer.byteLength(msg.content, 'utf8')} payload bytes)`,
    );

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
      for (const panel of this.layout.allPanels) {
        const panelId = panel.panelIndex;
        const tp = this.layout.getTerminalPanel(panelId);
        const agent = this.agentManager.getAgentType(panelId);
        if (tp && agent) {
          info.push(`  Panel ${panelId + 1}: ${agent} (${tp.isRunning ? 'running' : 'stopped'})`);
        } else if (tp) {
          info.push(`  Panel ${panelId + 1}: terminal (no agent)`);
        } else {
          info.push(`  Panel ${panelId + 1}: file browser`);
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
        '  BROADCAST           — send to all other connected agents',
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

  /** Serialize all Commander-generated writes for one managed session. */
  private async withSessionInputLane<T>(
    target: ManagedTaskTarget,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const previous = this.inputLaneTails.get(target.sessionId);
    if (!previous) {
      let releaseLane!: () => void;
      const tail = new Promise<void>((resolve) => {
        releaseLane = resolve;
      });
      this.inputLaneTails.set(target.sessionId, tail);
      try {
        return await operation();
      } finally {
        releaseLane();
        if (this.inputLaneTails.get(target.sessionId) === tail) {
          this.inputLaneTails.delete(target.sessionId);
        }
      }
    }

    const run = previous.then(operation, operation);
    const tail = run.then(() => undefined, () => undefined);
    this.inputLaneTails.set(target.sessionId, tail);
    try {
      return await run;
    } finally {
      if (this.inputLaneTails.get(target.sessionId) === tail) {
        this.inputLaneTails.delete(target.sessionId);
      }
    }
  }

  /** Input-lane hook for trusted Commander controls and future approvals. */
  async sendProgrammaticInput(
    tp: TerminalPanel,
    text: string,
    submit = false,
  ): Promise<boolean> {
    const normalized = this.normalizeProgrammaticPayload(text);
    if (!normalized.success) return false;
    const agentType = this.agentManager.getAgentType(tp.panelIndex);
    if (!agentType) return false;
    const target = this.captureManagedTaskTarget(tp.panelIndex, tp, agentType);
    if (!target) return false;
    return this.withSessionInputLane(target, () => (
      this.isManagedTaskTargetCurrent(target)
      && tp.sendInput(`${normalized.text}${submit ? '\r' : ''}`)
    ));
  }

  /**
   * Submit Enter to an already-selected Codex decision only if the exact
   * session and complete visible prompt remain unchanged inside its input lane.
   * This never navigates options and never sends an affirmative answer string.
   */
  async submitGuardedCodexDecision(
    tp: TerminalPanel,
    expected: GuardedCodexDecision,
  ): Promise<boolean> {
    if (
      !tp.isRunning
      || tp.sessionGeneration !== expected.sessionGeneration
      || !tp.inputSynchronized
      || tp.inputGeneration !== expected.inputGeneration
    ) return false;
    const target = this.captureManagedTaskTarget(tp.panelIndex, tp, 'codex');
    if (!target || target.sessionId !== expected.sessionId) return false;

    return this.withSessionInputLane(target, () => {
      if (
        (expected.validateOrigin && !expected.validateOrigin())
        || !this.isManagedTaskTargetCurrent(target)
        || !tp.isRunning
        || tp.sessionGeneration !== expected.sessionGeneration
        || !tp.inputSynchronized
        || tp.inputGeneration !== expected.inputGeneration
      ) return false;

      const detected = detectCodexDecision(tp.getVisibleGridLines(), expected.action);
      return detected?.fingerprint === expected.fingerprint && tp.sendInput('\r');
    });
  }

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
    const normalized = this.normalizeProgrammaticPayload(text);
    if (!normalized.success) {
      logger.warn(`Orchestrator: refused unsafe info payload for panel ${panelIndex + 1}`);
      return;
    }
    text = normalized.text;
    const tp = this.layout.getTerminalPanel(panelIndex);
    if (!tp?.isRunning) return;

    const agentType = this.agentManager.getAgentType(panelIndex);
    if (!agentType) return;
    const target = this.captureManagedTaskTarget(panelIndex, tp, agentType);
    if (!target) return;

    void this.withSessionInputLane(target, () => {
      if (!this.isManagedTaskTargetCurrent(target)) return false;
      let sent: boolean;
      if (agentType === 'claude') {
        // Type directly — no bracketed paste = no bypass permissions prompt.
        // Flatten newlines so \n doesn't get misinterpreted by Ink.
        // Truncate to terminal width to prevent line-wrap ghost artifacts:
        // when Claude's Ink TUI redraws, it doesn't clear wrapped overflow
        // rows from injected text, leaving ghost characters on screen.
        const flat = text.replace(/\n/g, ' ');
        const maxCols = tp.cols ?? 120;
        const trimmed = flat.length > maxCols - 2 ? flat.slice(0, maxCols - 5) + '...' : flat;
        sent = tp.sendInput(trimmed + '\r');
      } else {
        sent = tp.sendInput(`\x1b[200~${text}\x1b[201~\r`);
      }
      if (sent) {
        logger.info(
          `Orchestrator: info → panel ${panelIndex} (${Buffer.byteLength(text, 'utf8')} payload bytes)`,
        );
      }
      return sent;
    }).catch((error) => {
      logger.error(`Orchestrator: failed to send info to panel ${panelIndex}`, error);
    });
  }

  // ── Send protocol instructions to an agent ────────────────────

  /** Create a capability for an explicitly trusted internal session. */
  createProtocolCapability(): string {
    return generateProtocolCapability();
  }

  /**
   * Arm only the bundled internal demo profile. Normal agent sessions are
   * armed exclusively by injectProtocol, which is invoked from Ctrl+P.
   */
  armInternalProtocol(tp: TerminalPanel, capability: string): boolean {
    if (!isProtocolCapability(capability)) return false;
    const agentType = this.agentManager.getAgentType(tp.panelIndex);
    if (!agentType) return false;
    const target = this.captureManagedTaskTarget(tp.panelIndex, tp, agentType, 'internal');
    if (!target) return false;
    this.armProtocolTarget(target, capability, true);
    return true;
  }

  private armProtocolTarget(
    target: ManagedTaskTarget,
    capability: string,
    engaged: boolean,
  ): void {
    this.protocolCapabilities.set(target.sessionId, capability);
    this.protocolInjected.add(target.panelIndex);
    this.protocolSessionState.set(target.sessionId, {
      injectedAt: Date.now(),
      engaged,
      lastUserInputAt: 0,
    });
    this.injectionGrace.delete(target.panelIndex);
  }

  private disarmProtocolTarget(target: ManagedTaskTarget, capability: string): void {
    if (this.protocolCapabilities.get(target.sessionId) !== capability) return;
    this.protocolCapabilities.delete(target.sessionId);
    this.protocolSessionState.delete(target.sessionId);
    const currentSessionId = this.agentManager.getAgentSessionId(target.panelIndex);
    if (
      currentSessionId === target.sessionId
      || !currentSessionId
      || !this.protocolCapabilities.has(currentSessionId)
    ) {
      this.protocolInjected.delete(target.panelIndex);
    }
  }

  /**
   * Inject Commander protocol instructions into a running agent.
   * Call this after an agent has initialised.
   */
  async injectProtocol(tp: TerminalPanel): Promise<boolean> {
    if (!tp.isRunning) return false;

    const panelIndex = tp.panelIndex;
    const myAgent = this.agentManager.getAgentType(panelIndex);
    if (!myAgent) return false;

    const targetGeneration = this.captureManagedTaskTarget(panelIndex, tp, myAgent);
    if (!targetGeneration) return false;
    const targetIsCurrent = () => this.isManagedTaskTargetCurrent(targetGeneration);

    const myInfo = this.agentManager.getRunningAgents().find(
      (a) => a.panelIndex === panelIndex,
    );

    const others = this.agentManager.getRunningAgents()
      .filter((a) => a.panelIndex !== panelIndex)
      .map((a) => ({ name: a.name, type: a.type, panel: a.panelIndex }));

    const capability = generateProtocolCapability();
    const instructions = buildProtocolInstructions(
      panelIndex,
      myInfo?.name ?? myAgent,
      others,
      capability,
    );

    try {
      await this.withSessionInputLane(targetGeneration, async () => {
        if (!targetIsCurrent()) throw new Error('Managed session changed before protocol injection');
        // Rotation happens before the first byte is sent, invalidating every
        // capability previously issued to this session.
        this.armProtocolTarget(targetGeneration, capability, false);
        tp.markProtocolTextAsProcessed(instructions);
        if (
          await this.sendTextToAgent(tp, instructions, targetIsCurrent) === false
          || !targetIsCurrent()
        ) {
          throw new Error('Terminal stopped accepting protocol input');
        }
        if (await this.submitInput(tp, targetIsCurrent) === false || !targetIsCurrent()) {
          throw new Error('Terminal stopped accepting protocol input');
        }
        await this.delay(this.orchConfig.gridScanDelay);
        if (!targetIsCurrent()) throw new Error('Managed session changed during protocol injection');
        tp.snapshotVisibleProtocolAsProcessed();
      });
      logger.info(`Orchestrator: injected protocol instructions to panel ${panelIndex}`);
      return true;
    } catch (err) {
      this.disarmProtocolTarget(targetGeneration, capability);
      logger.error(`Orchestrator: protocol injection failed for panel ${panelIndex}`, err);
      return false;
    }
  }

  // ── Task queue ──────────────────────────────────────────────────

  private enqueueTask(
    panelIndex: number,
    task: Omit<
      QueuedTask,
      'id' | 'started' | 'cancelled' | 'queuedAt' | 'retained' | 'retainedBytes' | 'queuePanelIndex'
    >,
  ): EnqueueResult {
    const retainedBytes = Buffer.byteLength(task.task, 'utf8');
    const admissionError = this.getQueueAdmissionError(panelIndex, retainedBytes);
    if (admissionError) {
      this.rejectTask(panelIndex, task, admissionError);
      return { accepted: false, error: admissionError };
    }

    const queuedTask: QueuedTask = {
      ...task,
      id: this.nextTaskId++,
      started: false,
      cancelled: false,
      queuedAt: Date.now(),
      retained: true,
      retainedBytes,
      queuePanelIndex: panelIndex,
    };
    this.retainTask(queuedTask);

    const queueState = this.getOrCreateQueue(panelIndex);
    queueState.tasks.push(queuedTask);
    logger.info(`Orchestrator: queued task for panel ${panelIndex} (queue depth: ${queueState.tasks.length})`);

    if (!queueState.processing) {
      void this.processQueue(queueState);
    }

    return { accepted: true, task: queuedTask };
  }

  private getQueueAdmissionError(panelIndex: number, taskBytes: number): string | null {
    const panelTaskCount = this.retainedTaskCountByPanel.get(panelIndex) ?? 0;
    if (panelTaskCount >= ROUTED_QUEUE_MAX_TASKS_PER_PANEL) {
      return `Panel ${panelIndex + 1} routing queue is full (${ROUTED_QUEUE_MAX_TASKS_PER_PANEL} retained tasks)`;
    }
    if (this.retainedTaskCount >= ROUTED_QUEUE_MAX_TASKS_GLOBAL) {
      return `Global routing queue is full (${ROUTED_QUEUE_MAX_TASKS_GLOBAL} retained tasks)`;
    }

    const panelTaskBytes = this.retainedTaskBytesByPanel.get(panelIndex) ?? 0;
    if (panelTaskBytes + taskBytes > ROUTED_QUEUE_MAX_BYTES_PER_PANEL) {
      return `Panel ${panelIndex + 1} routing queue byte limit exceeded (${ROUTED_QUEUE_MAX_BYTES_PER_PANEL} bytes)`;
    }
    if (this.retainedTaskBytes + taskBytes > ROUTED_QUEUE_MAX_BYTES_GLOBAL) {
      return `Global routing queue byte limit exceeded (${ROUTED_QUEUE_MAX_BYTES_GLOBAL} bytes)`;
    }
    return null;
  }

  private rejectTask(
    panelIndex: number,
    task: Omit<
      QueuedTask,
      'id' | 'started' | 'cancelled' | 'queuedAt' | 'retained' | 'retainedBytes' | 'queuePanelIndex'
    >,
    error: string,
  ): void {
    if (task.messageId) this.ledger.markFailed(task.messageId, error);
    if (task.claimedReplyRoute) this.restoreReplyWindowIfActive(task.claimedReplyRoute);

    try {
      task.onComplete?.({ success: false, error });
    } catch (err) {
      logger.error('Orchestrator: rejected task completion callback failed', err);
    }

    if (task.source && this.isSourceSessionStillActive(task.source) && !task.skipAck) {
      const targetInfo = this.findRunningAgent(panelIndex);
      this.sendAck(
        task.source.panel,
        targetInfo?.name ?? task.agentType,
        panelIndex,
        false,
        task.messageId,
        task.threadId,
        error,
      );
    }
    logger.warn(`Orchestrator: rejected task for panel ${panelIndex}: ${error}`);
  }

  private retainTask(task: QueuedTask): void {
    this.retainedTaskCount += 1;
    this.retainedTaskBytes += task.retainedBytes;
    this.retainedTaskCountByPanel.set(
      task.queuePanelIndex,
      (this.retainedTaskCountByPanel.get(task.queuePanelIndex) ?? 0) + 1,
    );
    this.retainedTaskBytesByPanel.set(
      task.queuePanelIndex,
      (this.retainedTaskBytesByPanel.get(task.queuePanelIndex) ?? 0) + task.retainedBytes,
    );
  }

  private releaseTask(task: QueuedTask): void {
    if (!task.retained) return;
    task.retained = false;
    this.retainedTaskCount = Math.max(0, this.retainedTaskCount - 1);
    this.retainedTaskBytes = Math.max(0, this.retainedTaskBytes - task.retainedBytes);

    const panelTaskCount = Math.max(
      0,
      (this.retainedTaskCountByPanel.get(task.queuePanelIndex) ?? 0) - 1,
    );
    const panelTaskBytes = Math.max(
      0,
      (this.retainedTaskBytesByPanel.get(task.queuePanelIndex) ?? 0) - task.retainedBytes,
    );
    if (panelTaskCount === 0) this.retainedTaskCountByPanel.delete(task.queuePanelIndex);
    else this.retainedTaskCountByPanel.set(task.queuePanelIndex, panelTaskCount);
    if (panelTaskBytes === 0) this.retainedTaskBytesByPanel.delete(task.queuePanelIndex);
    else this.retainedTaskBytesByPanel.set(task.queuePanelIndex, panelTaskBytes);
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
        if (task.cancelled) {
          this.releaseTask(task);
          continue;
        }

        // Warn if task was stuck in queue for long
        const waitTime = Date.now() - task.queuedAt;
        if (waitTime > 10000) {
          logger.warn(`Orchestrator: task ${task.id} for panel ${(panelIndex ?? -1) + 1} was stuck in queue for ${waitTime}ms`);
        }

        task.started = true;
        queueState.currentTask = task;
        let result: { success: boolean; error?: string };
        try {
          result = await this.executeTask(
            task.agentType,
            panelIndex,
            task.task,
            task.directType,
            task.profileId,
            task.allowTargetMutation,
            task.bindTemplateCapability,
            task.targetExpectation,
          );
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          result = { success: false, error };
          logger.error(`Orchestrator: executeTask threw for panel ${panelIndex}`, err);
        }

        const currentPanelIndex = this.findQueuePanelIndex(queueState);
        if (queueState.detachedReason && currentPanelIndex === null) {
          result = { success: false, error: queueState.detachedReason };
        }

        const effectivePanelIndex = currentPanelIndex ?? panelIndex;
        if (
          result.success
          && task.targetExpectation
          && task.messageId
          && !this.isTaskTargetExpectationCurrent(task.targetExpectation)
        ) {
          result = this.targetExpectationUnavailable(task.targetExpectation);
        }
        try {
          task.onComplete?.(result);
        } catch (err) {
          logger.error(`Orchestrator: task completion callback failed for panel ${effectivePanelIndex}`, err);
        }
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
            if (task.claimedReplyRoute) this.restoreReplyWindowIfActive(task.claimedReplyRoute);
          }
        } else if (!result.success && task.claimedReplyRoute) {
          this.restoreReplyWindowIfActive(task.claimedReplyRoute);
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

        this.releaseTask(task);
        queueState.currentTask = null;
      }
    } finally {
      if (queueState.currentTask) this.releaseTask(queueState.currentTask);
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
   * Return detached snapshots of routed SEND, REPLY, and BROADCAST activity.
   * STATUS and QUERY are live interactions and are intentionally not history.
   */
  getRecentActivity(limit = 50): readonly MessageRecord[] {
    const count = Math.max(0, Math.trunc(limit));
    if (count === 0) return [];

    return this.ledger
      .getRecentMessages(Number.MAX_SAFE_INTEGER)
      .filter((record) => (
        record.kind === 'send' ||
        record.kind === 'reply' ||
        record.kind === 'broadcast'
      ))
      .slice(0, count);
  }

  /**
   * Capability-bind protocol blocks only for the explicit template workflow.
   * A collaboration template is rejected with a clear Ctrl+P instruction when
   * its target session has not been armed; ordinary task text is untouched.
   */
  prepareTemplateTask(
    panelIndex: number,
    content: string,
    requiresProtocol = false,
  ): ({ success: true } & PreparedTemplateTask) | { success: false; error: string } {
    const bindProtocolCapability = requiresProtocol || hasLegacyProtocolMarkers(content);
    if (!bindProtocolCapability) {
      return { success: true, content, bindProtocolCapability: false };
    }
    const tp = this.layout.getTerminalPanel(panelIndex);
    const sessionId = this.agentManager.getAgentSessionId(panelIndex);
    const capability = sessionId
      ? this.protocolCapabilities.get(sessionId)
      : undefined;
    if (
      !tp?.isRunning
      || !sessionId
      || !capability
      || !this.protocolInjected.has(panelIndex)
    ) {
      return {
        success: false,
        error: `Collaboration template requires an armed agent in Panel ${panelIndex + 1}; press Ctrl+P there, then send the template again`,
      };
    }
    return {
      success: true,
      // Binding is deliberately deferred until this task owns the target
      // session's input lane. A confirmation dialog or queue wait may outlive
      // the capability that was current here.
      content,
      bindProtocolCapability: true,
    };
  }

  /**
   * Send a task to an agent panel. Tasks targeting the same panel are
   * queued and processed sequentially to prevent interleaved input.
   */
  async sendTask(
    agentType: AgentType,
    panelIndex: number,
    task: string,
    profileId?: string,
    targetExpectation?: TaskTargetExpectation,
  ): Promise<{ success: boolean; error?: string }> {
    return this.enqueueUserTask(
      agentType,
      panelIndex,
      task,
      profileId,
      false,
      targetExpectation,
    );
  }

  /** Deliver a template prepared by prepareTemplateTask(). */
  async sendTemplateTask(
    agentType: AgentType,
    panelIndex: number,
    prepared: PreparedTemplateTask,
    profileId?: string,
    targetExpectation?: TaskTargetExpectation,
  ): Promise<{ success: boolean; error?: string }> {
    return this.enqueueUserTask(
      agentType,
      panelIndex,
      prepared.content,
      profileId,
      prepared.bindProtocolCapability,
      targetExpectation,
    );
  }

  private async enqueueUserTask(
    agentType: AgentType,
    panelIndex: number,
    task: string,
    profileId: string | undefined,
    bindTemplateCapability: boolean,
    targetExpectation: TaskTargetExpectation | undefined,
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

      const admission = this.enqueueTask(panelIndex, {
        agentType,
        ...(profileId ? { profileId } : {}),
        task,
        ...(bindTemplateCapability
          ? { bindTemplateCapability: true, allowTargetMutation: false }
          : {}),
        ...(targetExpectation ? { targetExpectation } : {}),
        onComplete: (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        },
      });
      queuedTask = admission.accepted ? admission.task : null;
    });
  }

  // ── Task execution (internal) ──────────────────────────────────

  private async executeTask(
    agentType: AgentType,
    panelIndex: number,
    task: string,
    directType?: boolean,
    profileId?: string,
    allowTargetMutation = true,
    bindTemplateCapability = false,
    targetExpectation?: TaskTargetExpectation,
  ): Promise<{ success: boolean; error?: string }> {
    const normalizedTask = this.normalizeProgrammaticPayload(task);
    if (!normalizedTask.success) {
      return { success: false, error: normalizedTask.error };
    }
    task = normalizedTask.text;
    if (!this.layout.hasPanel(panelIndex)) {
      return {
        success: false,
        error: `Panel ${panelIndex + 1} is not available`,
      };
    }
    if (
      targetExpectation
      && (
        targetExpectation.panelIndex !== panelIndex
        || !this.isTaskTargetExpectationCurrent(targetExpectation)
      )
    ) {
      return this.targetExpectationUnavailable(targetExpectation);
    }

    const existingTerminal = this.layout.getTerminalPanel(panelIndex);
    const existingAgent = this.agentManager.getAgentType(panelIndex);
    const existingProfile = typeof this.agentManager.getAgentProfileId === 'function'
      ? this.agentManager.getAgentProfileId(panelIndex)
      : existingAgent;
    const reusesExisting = Boolean(
      existingTerminal?.isRunning &&
      existingAgent === agentType &&
      (profileId === undefined || existingProfile === profileId),
    );
    if (!allowTargetMutation && !reusesExisting) {
      if (!existingTerminal || !existingTerminal.isRunning || !existingAgent) {
        return {
          success: false,
          error: `Protocol routing requires Panel ${panelIndex + 1} to already run ${agentType}`,
        };
      }
      const actualTarget = existingProfile && existingProfile !== existingAgent
        ? `${existingAgent} profile ${existingProfile}`
        : existingAgent;
      return {
        success: false,
        error: `Protocol routing refused to replace ${actualTarget} in Panel ${panelIndex + 1} with ${agentType}`,
      };
    }
    const launchError = reusesExisting
      ? null
      : profileId !== undefined
        ? this.agentManager.getProfileLaunchError?.(profileId, agentType)
        : this.agentManager.getAgentLaunchError?.(agentType);
    if (launchError) {
      return { success: false, error: launchError };
    }

    // 1. Convert to terminal if it's a file panel.
    const tp = this.layout.convertToTerminal(panelIndex);
    if (!this.isCurrentTarget(panelIndex, tp)) {
      return this.targetUnavailable(panelIndex);
    }

    // 2. Launch agent if not running or different agent
    const currentAgent = this.agentManager.getAgentType(panelIndex);
    const currentProfile = typeof this.agentManager.getAgentProfileId === 'function'
      ? this.agentManager.getAgentProfileId(panelIndex)
      : currentAgent;
    const needsLaunch = !tp.isRunning || currentAgent !== agentType || (
      profileId !== undefined && currentProfile !== profileId
    );
    let targetGeneration: ManagedTaskTarget | null = null;

    if (needsLaunch) {
      if (tp.isRunning) {
        // Kill managed agent or raw terminal session
        if (currentAgent) {
          await this.agentManager.killAgent(panelIndex);
        } else {
          await tp.killAgent(true);
        }
        if (!this.isCurrentTarget(panelIndex, tp)) {
          return this.targetUnavailable(panelIndex);
        }
        if (
          this.agentManager.getAgentSessionId(panelIndex) !== null
          || tp.isRunning
        ) {
          return this.managedTargetUnavailable(panelIndex);
        }
      }

      this.protocolInjected.delete(panelIndex);
      const ok = profileId !== undefined && typeof this.agentManager.launchProfile === 'function'
        ? this.agentManager.launchProfile(profileId, tp)
        : this.agentManager.launchAgent(agentType, tp);
      if (!ok) {
        return { success: false, error: `Failed to launch ${agentType}` };
      }
      if (!this.isCurrentTarget(panelIndex, tp)) {
        return this.targetUnavailable(panelIndex);
      }
      targetGeneration = this.captureManagedTaskTarget(panelIndex, tp, agentType, profileId);
      if (!targetGeneration) {
        return this.managedTargetUnavailable(panelIndex);
      }

      // Connect monitoring
      this.connectPanel(tp);

      logger.info(`Orchestrator: launched ${agentType} on panel ${panelIndex}, waiting for init…`);
      await this.delay(this.orchConfig.initDelay);
      if (!this.isManagedTaskTargetCurrent(targetGeneration)) {
        return this.managedTargetUnavailable(panelIndex);
      }

      // Protocol injection is manual only (Ctrl+P). Do NOT auto-inject here —
      // it floods the agent with text while it's still initializing and causes
      // unwanted message queueing (e.g. Codex's "submitted after next tool call").
    } else {
      targetGeneration = this.captureManagedTaskTarget(panelIndex, tp, agentType, profileId);
      if (!targetGeneration) {
        return this.managedTargetUnavailable(panelIndex);
      }
    }

    // 3. Ensure panel is connected for inter-agent message detection
    if (!this.isManagedTaskTargetCurrent(targetGeneration)) {
      return this.managedTargetUnavailable(panelIndex);
    }
    this.connectPanel(tp);

    // 4-5. Send the task text.
    //    Claude Code: short single-line tasks can still be typed directly to
    //    avoid the "bypass permissions" prompt, but longer routed replies are
    //    more reliable via bracketed paste + delayed submit.
    //    Other agents / manual sends: bracketed paste preserves formatting.
    const currentAgentType = targetGeneration.agentType;
    const targetIsCurrent = () => this.isManagedTaskTargetCurrent(targetGeneration);
    const deliveryFailure = await this.withSessionInputLane<{
      success: false;
      error: string;
    } | null>(targetGeneration, async () => {
      if (!targetIsCurrent()) return this.managedTargetUnavailable(panelIndex);
      if (bindTemplateCapability) {
        const capability = this.protocolCapabilities.get(targetGeneration.sessionId);
        if (
          !capability
          || !this.protocolInjected.has(panelIndex)
          || !targetIsCurrent()
        ) {
          return {
            success: false,
            error: `Collaboration template requires the current agent in Panel ${panelIndex + 1} to be armed with Ctrl+P`,
          };
        }
        task = bindTemplateProtocolCapability(task, capability);
      }
      tp.reserveProtocolTextForEcho(task);
      if (currentAgentType === 'claude' && this.shouldDirectTypeToClaude(task, directType)) {
        const flat = task.replace(/\n/g, ' ');
        const sent = await this.sendTextChunked(tp, flat, targetIsCurrent);
        if (sent === false || !targetIsCurrent()) {
          return this.targetDeliveryFailure(panelIndex, tp, targetGeneration);
        }
        await this.delay(CLAUDE_DIRECT_SUBMIT_DELAY_MS);
        if (!targetIsCurrent() || tp.sendInput('\r') === false) {
          return this.targetDeliveryFailure(panelIndex, tp, targetGeneration);
        }
        if (!targetIsCurrent()) return this.managedTargetUnavailable(panelIndex);
        tp.showCommanderActivity('Commander task received');
        logger.info(`Orchestrator: typed short task directly to Claude on panel ${panelIndex} (${task.length} chars)`);
      } else {
        const sent = await this.sendTextToAgent(tp, task, targetIsCurrent);
        if (sent === false || !targetIsCurrent()) {
          return this.targetDeliveryFailure(panelIndex, tp, targetGeneration);
        }
        const submitted = await this.submitInput(tp, targetIsCurrent);
        if (submitted === false || !targetIsCurrent()) {
          return this.targetDeliveryFailure(panelIndex, tp, targetGeneration);
        }
        if (!targetIsCurrent()) return this.managedTargetUnavailable(panelIndex);
        tp.showCommanderActivity('Commander task received');
        logger.info(
          `Orchestrator: sent task to ${agentType} on panel ${panelIndex} (${task.length} chars)` +
          `${currentAgentType === 'claude' && directType ? ' using paste fallback' : ''}`,
        );
      }
      return null;
    });
    if (deliveryFailure) return deliveryFailure;

    // 6. Focus the target panel
    if (!targetIsCurrent()) {
      return this.managedTargetUnavailable(panelIndex);
    }
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
  private async submitInput(
    tp: TerminalPanel,
    isStillValid: () => boolean = () => true,
  ): Promise<boolean> {
    const agentType = this.agentManager.getAgentType(tp.panelIndex);
    if (agentType === 'claude') {
      // Delay so the paste is read + bypass prompt rendered before \r.
      // The prompt appears within 1-2s; 2.5s gives comfortable margin.
      await this.delay(this.orchConfig.claudeSubmitDelay);
      if (!isStillValid()) return false;
      return tp.sendInput('\r');
    } else {
      await this.delay(100);
      if (!isStillValid()) return false;
      return tp.sendInput('\r');
    }
  }

  /**
   * Normalize portable line endings, then reject terminal control bytes that
   * could escape bracketed paste or trigger an unintended submit/action.
   * Tab and LF are the only allowed C0 characters in prompt payloads.
   */
  private normalizeProgrammaticPayload(
    text: string,
  ): { success: true; text: string } | { success: false; error: string } {
    const normalized = text.replace(/\r\n/g, '\n');
    const unsafe = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.exec(normalized);
    if (!unsafe) return { success: true, text: normalized };
    const codePoint = unsafe[0].codePointAt(0) ?? 0;
    return {
      success: false,
      error: `Payload contains unsafe terminal control U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
    };
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
  private async sendTextToAgent(
    tp: TerminalPanel,
    text: string,
    isStillValid: () => boolean = () => true,
  ): Promise<boolean> {
    const normalized = this.normalizeProgrammaticPayload(text);
    if (!normalized.success) return false;
    if (!isStillValid() || !tp.sendInput('\x1b[200~')) return false;
    if (!await this.sendTextChunked(tp, normalized.text, isStillValid)) return false;
    return isStillValid() && tp.sendInput('\x1b[201~');
  }

  /**
   * Send text in chunks to avoid PTY input buffer overflows.
   * 1024 bytes stays within the PTY line discipline buffer on all platforms
   * (macOS MAX_INPUT=1024 in non-canonical mode, Linux=4096).
   */
  private async sendTextChunked(
    tp: TerminalPanel,
    text: string,
    isStillValid: () => boolean = () => true,
  ): Promise<boolean> {
    const normalized = this.normalizeProgrammaticPayload(text);
    if (!normalized.success) return false;
    const CHUNK_SIZE = 1024;
    const chunks: string[] = [];
    let chunk = '';
    let chunkBytes = 0;
    for (const codePoint of normalized.text) {
      const codePointBytes = Buffer.byteLength(codePoint, 'utf8');
      if (chunk && chunkBytes + codePointBytes > CHUNK_SIZE) {
        chunks.push(chunk);
        chunk = '';
        chunkBytes = 0;
      }
      chunk += codePoint;
      chunkBytes += codePointBytes;
    }
    if (chunk) chunks.push(chunk);

    for (let i = 0; i < chunks.length; i++) {
      if (!isStillValid() || !tp.sendInput(chunks[i])) {
        return false;
      }
      if (i + 1 < chunks.length) {
        await this.delay(15);
        if (!isStillValid()) return false;
      }
    }
    return true;
  }

  private isCurrentTarget(panelIndex: number, tp: TerminalPanel): boolean {
    return this.layout.hasPanel(panelIndex) && this.layout.getTerminalPanel(panelIndex) === tp;
  }

  private captureManagedTaskTarget(
    panelIndex: number,
    terminal: TerminalPanel,
    expectedAgentType: AgentType,
    expectedProfileId?: string,
  ): ManagedTaskTarget | null {
    if (!this.isCurrentTarget(panelIndex, terminal)) return null;
    const sessionId = this.agentManager.getAgentSessionId(panelIndex);
    const agentType = this.agentManager.getAgentType(panelIndex);
    const profileId = typeof this.agentManager.getAgentProfileId === 'function'
      ? this.agentManager.getAgentProfileId(panelIndex)
      : agentType;
    if (!sessionId || agentType !== expectedAgentType || !profileId) return null;
    if (expectedProfileId !== undefined && profileId !== expectedProfileId) return null;
    return { panelIndex, terminal, sessionId, agentType, profileId };
  }

  private isManagedTaskTargetCurrent(target: ManagedTaskTarget): boolean {
    if (!this.isCurrentTarget(target.panelIndex, target.terminal)) return false;
    const profileId = typeof this.agentManager.getAgentProfileId === 'function'
      ? this.agentManager.getAgentProfileId(target.panelIndex)
      : this.agentManager.getAgentType(target.panelIndex);
    return this.agentManager.getAgentSessionId(target.panelIndex) === target.sessionId
      && this.agentManager.getAgentType(target.panelIndex) === target.agentType
      && profileId === target.profileId;
  }

  private targetUnavailable(panelIndex: number): { success: false; error: string } {
    return {
      success: false,
      error: `Panel ${panelIndex + 1} is no longer available`,
    };
  }

  private managedTargetUnavailable(panelIndex: number): { success: false; error: string } {
    return this.layout.hasPanel(panelIndex)
      ? {
          success: false,
          error: `Panel ${panelIndex + 1} managed session changed before delivery`,
        }
      : this.targetUnavailable(panelIndex);
  }

  private targetDeliveryFailure(
    panelIndex: number,
    tp: TerminalPanel,
    targetGeneration?: ManagedTaskTarget,
  ): { success: false; error: string } {
    if (targetGeneration && !this.isManagedTaskTargetCurrent(targetGeneration)) {
      return this.managedTargetUnavailable(panelIndex);
    }
    return this.isCurrentTarget(panelIndex, tp)
      ? {
          success: false,
          error: `Panel ${panelIndex + 1} terminal is not accepting input`,
        }
      : this.targetUnavailable(panelIndex);
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
      this.releaseTask(task);
      if (task.messageId) {
        this.ledger.markFailed(task.messageId, 'Task was cancelled before delivery', 'timed_out');
      }
      if (task.claimedReplyRoute) this.restoreReplyWindowIfActive(task.claimedReplyRoute);
      return true;
    }
    return false;
  }

  private failPendingTasks(queueState: PanelQueueState, error: string): void {
    const pendingTasks = queueState.tasks.splice(0);
    for (const task of pendingTasks) {
      this.releaseTask(task);
      if (task.cancelled) continue;
      task.cancelled = true;
      if (task.messageId) {
        this.ledger.markFailed(task.messageId, error, 'dropped');
      }
      if (task.claimedReplyRoute) this.restoreReplyWindowIfActive(task.claimedReplyRoute);
      try {
        task.onComplete?.({ success: false, error });
      } catch (err) {
        logger.error('Orchestrator: failed to settle queued task during teardown', err);
      }
    }
  }

  private scrubSourceReferences(panelIndex: number): void {
    for (const queueState of this.panelQueues.values()) {
      queueState.tasks = queueState.tasks.filter((task) => {
        if (task.source?.panel !== panelIndex) return true;
        task.cancelled = true;
        this.releaseTask(task);
        if (task.messageId) {
          this.ledger.markFailed(task.messageId, `Source panel ${panelIndex + 1} is no longer available`, 'dropped');
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
        queueState.currentTask.claimedReplyRoute = undefined;
      }
    }
  }

  private restoreReplyWindowIfActive(route: PendingReplyRoute): void {
    const waitingPanel = this.agentManager.findPanelBySessionId(route.waitingOnSessionId);
    const returnPanel = this.agentManager.findPanelBySessionId(route.returnToSessionId);
    if (typeof waitingPanel !== 'number' || typeof returnPanel !== 'number') return;
    this.ledger.restoreReplyWindow(route);
  }
}
