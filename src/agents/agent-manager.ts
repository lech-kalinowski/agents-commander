import type { AgentType, AgentInfo } from './types.js';
import { getAgentInfo } from './agent-registry.js';
import {
  TerminalPanel,
  type TerminalProcessExitReason,
} from '../panels/terminal-panel.js';
import { logger } from '../utils/logger.js';
import type { AgentCommandConfig } from '../config/types.js';

interface ManagedAgent {
  type: AgentType;
  info: AgentInfo;
  panel: TerminalPanel;
  launchedAt: Date;
  restartCount: number;
  sessionId: string;
  restartTimer: ReturnType<typeof setTimeout> | null;
  autoRestart: boolean;
}

export interface InternalAgentLaunchSpec {
  name: string;
  command: string;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
}

export interface RunningAgentInfo {
  panelIndex: number;
  sessionId: string;
  type: AgentType;
  name: string;
  status: string;
  uptime: number;
}

interface AgentLifecycleEventBase {
  panelIndex: number;
  sessionId: string;
  previousSessionId?: string;
  agentType: AgentType;
  agentName: string;
}

export type AgentExitReason =
  | TerminalProcessExitReason
  | 'requested'
  | 'replaced'
  | 'shutdown';

export type AgentLifecycleEvent = AgentLifecycleEventBase & (
  | {
    type: 'launched' | 'restarted';
    exitCode?: never;
    signal?: never;
  }
  | {
    type: 'exited';
    exitCode: number | null;
    signal: string | null;
    reason: AgentExitReason;
  }
);

export class AgentManager {
  private static MAX_RESTARTS = 3;
  private static MIN_RESTART_UPTIME_MS = 5000;
  private agents: Map<number, ManagedAgent> = new Map(); // keyed by panelIndex
  private sessionSeq = 1;
  private lifecycleListeners = new Set<(event: AgentLifecycleEvent) => void>();
  private shutdownStarted = false;

  constructor(private agentOverrides?: Record<string, AgentCommandConfig>) {}

  launchAgent(agentType: AgentType, panel: TerminalPanel): boolean {
    if (this.shutdownStarted) {
      logger.warn(`Agent manager: refusing to launch ${agentType}; shutdown has begun`);
      return false;
    }
    const info = getAgentInfo(agentType, this.agentOverrides);
    if (!info) {
      logger.error(`Unknown agent type: ${agentType}`);
      return false;
    }

    if (!info.installed) {
      logger.error(`Agent not installed: ${info.name}. Run: ${info.installCommand}`);
      return false;
    }

    if (!info.supported) {
      logger.error(`Agent not yet supported: ${info.name}`);
      return false;
    }

    this.prepareManagedPanel(panel);

    const launched = this.performLaunch(agentType, info, panel);
    if (!launched) return false;

    this.registerManagedAgent(agentType, info, panel, true);
    return true;
  }

  /**
   * Launch a bundled/offline agent while retaining normal managed-session
   * identity and protocol scanning. Internal agents intentionally do not
   * auto-restart: their finite exit is part of the demo lifecycle.
   */
  launchInternalAgent(spec: InternalAgentLaunchSpec, panel: TerminalPanel): boolean {
    if (this.shutdownStarted) {
      logger.warn(`Agent manager: refusing to launch ${spec.name}; shutdown has begun`);
      return false;
    }
    if (!spec.name.trim() || !spec.command.trim()) {
      logger.error('Internal agent launch requires a non-empty name and command');
      return false;
    }

    const info: AgentInfo = {
      type: 'generic',
      name: spec.name,
      command: spec.command,
      args: [...(spec.args ?? [])],
      env: { ...(spec.env ?? {}) },
      description: 'Bundled offline agent',
      installCommand: '',
      installed: true,
      supported: true,
    };

    this.prepareManagedPanel(panel);
    if (panel.isRunning) {
      panel.killAgent(true);
    }
    const launched = panel.launchInternalAgent(
      info.name,
      info.command,
      info.args,
      info.env,
    );
    if (!launched) return false;

    this.registerManagedAgent('generic', info, panel, false);
    logger.info(
      `Agent manager: launched internal ${info.name} on panel ${panel.panelIndex}`,
    );
    return true;
  }

  private performLaunch(agentType: AgentType, info: AgentInfo, panel: TerminalPanel): boolean {
    // Kill existing PTY session if any
    if (panel.isRunning) {
      panel.killAgent(true);
    }

    // Build args — inject project directory flag so agent treats panel CWD as project root
    const args = [...info.args];
    if (info.projectDirFlag) {
      args.push(info.projectDirFlag, panel.workingDir);
    }

    const launched = panel.launchAgent(
      agentType,
      info.name,
      info.command,
      args,
      info.env,
    );

    if (launched) {
      logger.info(`Agent manager: launched ${info.name} on panel ${panel.panelIndex}`);
    }
    return launched;
  }

  private handleAgentExit(
    panelIndex: number,
    code: number | null,
    signal: string | null,
    reason: TerminalProcessExitReason = 'process-exit',
  ): void {
    const managed = this.agents.get(panelIndex);
    if (!managed) return;
    if (managed.restartTimer) return;

    if (managed.autoRestart === false) {
      this.emitLifecycle({
        type: 'exited',
        panelIndex,
        sessionId: managed.sessionId,
        agentType: managed.type,
        agentName: managed.info.name,
        exitCode: code,
        signal,
        reason,
      });
      this.agents.delete(panelIndex);
      return;
    }

    const uptimeMs = Date.now() - managed.launchedAt.getTime();

    // A process that rejects its startup arguments exits immediately. Retrying
    // the identical command only creates a noisy restart storm, so only
    // restart sessions that were healthy long enough to be considered started.
    if (code !== 0 && code !== null && signal === null) {
      if (uptimeMs < AgentManager.MIN_RESTART_UPTIME_MS) {
        logger.error(`Agent manager: ${managed.info.name} on panel ${panelIndex} failed during startup (code=${code}). Not restarting.`);
      } else if (managed.restartCount < AgentManager.MAX_RESTARTS) {
        managed.restartCount++;
        logger.warn(`Agent manager: ${managed.info.name} on panel ${panelIndex} crashed (code=${code}). Restarting (${managed.restartCount}/${AgentManager.MAX_RESTARTS})...`);
        
        // Wait a bit before restarting to avoid tight loops
        managed.restartTimer = setTimeout(() => {
          managed.restartTimer = null;
          const currentPanelIndex = this.findManagedPanelIndex(managed);
          if (currentPanelIndex === null) return;

          const previousSessionId = managed.sessionId;
          const relaunched = this.performLaunch(managed.type, managed.info, managed.panel);
          if (!relaunched) {
            this.emitLifecycle({
              type: 'exited',
              panelIndex: currentPanelIndex,
              sessionId: previousSessionId,
              agentType: managed.type,
              agentName: managed.info.name,
              exitCode: code,
              signal,
              reason,
            });
            if (this.agents.get(currentPanelIndex) === managed) {
              this.agents.delete(currentPanelIndex);
            }
            return;
          }

          managed.sessionId = this.makeSessionId(managed.type, currentPanelIndex);
          managed.launchedAt = new Date();
          this.emitLifecycle({
            type: 'restarted',
            panelIndex: currentPanelIndex,
            sessionId: managed.sessionId,
            previousSessionId,
            agentType: managed.type,
            agentName: managed.info.name,
          });
        }, 1000);
        return;
      } else {
        logger.error(`Agent manager: ${managed.info.name} on panel ${panelIndex} reached max restarts. Giving up.`);
      }
    }

    // Regular exit or max restarts reached — clean up
    this.emitLifecycle({
      type: 'exited',
      panelIndex,
      sessionId: managed.sessionId,
      agentType: managed.type,
      agentName: managed.info.name,
      exitCode: code,
      signal,
      reason,
    });
    this.agents.delete(panelIndex);
  }

  killAgent(panelIndex: number): Promise<void> {
    const managed = this.agents.get(panelIndex);
    if (managed) {
      this.cancelRestart(managed);
      const termination = managed.panel.killAgent();
      this.emitLifecycle({
        type: 'exited',
        panelIndex,
        sessionId: managed.sessionId,
        agentType: managed.type,
        agentName: managed.info.name,
        exitCode: null,
        signal: null,
        reason: 'requested',
      });
      this.agents.delete(panelIndex);
      logger.info(`Agent manager: killed agent on panel ${panelIndex}`);
      return Promise.resolve(termination);
    }
    return Promise.resolve();
  }

  killAll(): Promise<void> {
    const terminations: Array<Promise<void>> = [];
    for (const [idx, managed] of this.agents) {
      this.cancelRestart(managed);
      terminations.push(Promise.resolve(managed.panel.killAgent()));
      this.emitLifecycle({
        type: 'exited',
        panelIndex: idx,
        sessionId: managed.sessionId,
        agentType: managed.type,
        agentName: managed.info.name,
        exitCode: null,
        signal: null,
        reason: 'requested',
      });
    }
    this.agents.clear();
    logger.info('Agent manager: killed all agents');
    return Promise.allSettled(terminations).then(() => undefined);
  }

  /**
   * Stop lifecycle management without initiating process termination.
   * App shutdown uses the returned panels to perform bounded asynchronous
   * termination while preventing any pending auto-restart from racing it.
   */
  prepareForShutdown(): TerminalPanel[] {
    this.shutdownStarted = true;
    const panels = new Set<TerminalPanel>();
    for (const [panelIndex, managed] of this.agents) {
      this.cancelRestart(managed);
      panels.add(managed.panel);
      this.emitLifecycle({
        type: 'exited',
        panelIndex,
        sessionId: managed.sessionId,
        agentType: managed.type,
        agentName: managed.info.name,
        exitCode: null,
        signal: null,
        reason: 'shutdown',
      });
    }
    this.agents.clear();
    return [...panels];
  }

  reindexAfterPanelRemoval(removedPanelIndex: number): void {
    const reindexed = new Map<number, ManagedAgent>();
    for (const [panelIndex, managed] of this.agents) {
      if (panelIndex === removedPanelIndex) {
        this.cancelRestart(managed);
        continue;
      }
      const nextIndex = panelIndex > removedPanelIndex ? panelIndex - 1 : panelIndex;
      reindexed.set(nextIndex, managed);
    }
    this.agents = reindexed;
  }

  getRunningAgents(): RunningAgentInfo[] {
    const result: RunningAgentInfo[] = [];
    const now = new Date().getTime();

    for (const [idx, managed] of this.agents) {
      if (!managed.panel.isRunning && !managed.restartTimer) {
        // Stale entry cleanup (though onExit should handle most cases)
        this.agents.delete(idx);
        continue;
      }

      result.push({
        panelIndex: idx,
        sessionId: managed.sessionId,
        type: managed.type,
        name: managed.info.name,
        status: managed.restartTimer ? 'restarting' : managed.panel.status,
        uptime: Math.floor((now - managed.launchedAt.getTime()) / 1000),
      });
    }
    return result;
  }

  isAgentRunning(panelIndex: number): boolean {
    const managed = this.agents.get(panelIndex);
    return managed?.panel.isRunning ?? false;
  }

  hasAgent(panelIndex: number): boolean {
    return this.agents.has(panelIndex);
  }

  getAgentType(panelIndex: number): AgentType | null {
    const managed = this.agents.get(panelIndex);
    if (!managed || !managed.panel.isRunning) return null;
    return managed.type;
  }

  getAgentSessionId(panelIndex: number): string | null {
    const managed = this.agents.get(panelIndex);
    if (!managed || !managed.panel.isRunning) return null;
    return managed.sessionId;
  }

  findPanelBySessionId(sessionId: string): number | null {
    for (const [panelIndex, managed] of this.agents) {
      if (managed.sessionId === sessionId && managed.panel.isRunning) {
        return panelIndex;
      }
    }
    return null;
  }

  onLifecycle(listener: (event: AgentLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  private emitLifecycle(event: AgentLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('Agent manager: lifecycle listener failed', err);
      }
    }
  }

  private prepareManagedPanel(panel: TerminalPanel): void {
    const previous = this.agents.get(panel.panelIndex);
    if (previous) {
      this.cancelRestart(previous);
      this.emitLifecycle({
        type: 'exited',
        panelIndex: panel.panelIndex,
        sessionId: previous.sessionId,
        agentType: previous.type,
        agentName: previous.info.name,
        exitCode: null,
        signal: null,
        reason: 'replaced',
      });
      this.agents.delete(panel.panelIndex);
    }

    panel.onExit = (code, signal, reason) => {
      this.handleAgentExit(panel.panelIndex, code, signal, reason);
    };
  }

  private registerManagedAgent(
    agentType: AgentType,
    info: AgentInfo,
    panel: TerminalPanel,
    autoRestart: boolean,
  ): void {
    const sessionId = this.makeSessionId(agentType, panel.panelIndex);
    this.agents.set(panel.panelIndex, {
      type: agentType,
      info,
      panel,
      launchedAt: new Date(),
      restartCount: 0,
      sessionId,
      restartTimer: null,
      autoRestart,
    });
    this.emitLifecycle({
      type: 'launched',
      panelIndex: panel.panelIndex,
      sessionId,
      agentType,
      agentName: info.name,
    });
  }

  private cancelRestart(managed: ManagedAgent): void {
    if (!managed.restartTimer) return;
    clearTimeout(managed.restartTimer);
    managed.restartTimer = null;
  }

  private findManagedPanelIndex(managed: ManagedAgent): number | null {
    for (const [panelIndex, candidate] of this.agents) {
      if (candidate === managed) return panelIndex;
    }
    return null;
  }

  private makeSessionId(agentType: AgentType, panelIndex: number): string {
    const seq = this.sessionSeq++;
    return `${agentType}_${(panelIndex + 1).toString(36)}_${Date.now().toString(36)}_${seq.toString(36)}`;
  }
}
