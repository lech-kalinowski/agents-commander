import type { AgentType, AgentInfo } from './types.js';
import { getAgentInfo } from './agent-registry.js';
import { TerminalPanel } from '../panels/terminal-panel.js';
import { logger } from '../utils/logger.js';

interface ManagedAgent {
  type: AgentType;
  info: AgentInfo;
  panel: TerminalPanel;
  launchedAt: Date;
  restartCount: number;
  sessionId: string;
}

export interface RunningAgentInfo {
  panelIndex: number;
  sessionId: string;
  type: AgentType;
  name: string;
  status: string;
  uptime: number;
}

export interface AgentLifecycleEvent {
  type: 'launched' | 'restarted' | 'exited';
  panelIndex: number;
  sessionId: string;
  previousSessionId?: string;
  agentType: AgentType;
  agentName: string;
}

export class AgentManager {
  private static MAX_RESTARTS = 3;
  private agents: Map<number, ManagedAgent> = new Map(); // keyed by panelIndex
  private sessionSeq = 1;
  private lifecycleListeners = new Set<(event: AgentLifecycleEvent) => void>();

  launchAgent(agentType: AgentType, panel: TerminalPanel): boolean {
    const info = getAgentInfo(agentType);
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

    // Set exit handler for auto-restart
    panel.onExit = (code, signal) => {
      this.handleAgentExit(panel.panelIndex, code, signal);
    };

    const launched = this.performLaunch(agentType, info, panel);
    if (!launched) return false;

    const sessionId = this.makeSessionId(agentType, panel.panelIndex);
    this.agents.set(panel.panelIndex, {
      type: agentType,
      info,
      panel,
      launchedAt: new Date(),
      restartCount: 0,
      sessionId,
    });
    this.emitLifecycle({
      type: 'launched',
      panelIndex: panel.panelIndex,
      sessionId,
      agentType,
      agentName: info.name,
    });

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

  private handleAgentExit(panelIndex: number, code: number | null, signal: string | null): void {
    const managed = this.agents.get(panelIndex);
    if (!managed) return;

    // Only restart if it crashed (non-zero exit code) and not killed by a signal
    if (code !== 0 && code !== null && signal === null) {
      if (managed.restartCount < AgentManager.MAX_RESTARTS) {
        managed.restartCount++;
        logger.warn(`Agent manager: ${managed.info.name} on panel ${panelIndex} crashed (code=${code}). Restarting (${managed.restartCount}/${AgentManager.MAX_RESTARTS})...`);
        
        // Wait a bit before restarting to avoid tight loops
        setTimeout(() => {
          const previousSessionId = managed.sessionId;
          const relaunched = this.performLaunch(managed.type, managed.info, managed.panel);
          if (!relaunched) {
            this.emitLifecycle({
              type: 'exited',
              panelIndex,
              sessionId: previousSessionId,
              agentType: managed.type,
              agentName: managed.info.name,
            });
            this.agents.delete(panelIndex);
            return;
          }

          managed.sessionId = this.makeSessionId(managed.type, panelIndex);
          managed.launchedAt = new Date();
          this.emitLifecycle({
            type: 'restarted',
            panelIndex,
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
    });
    this.agents.delete(panelIndex);
  }

  killAgent(panelIndex: number): void {
    const managed = this.agents.get(panelIndex);
    if (managed) {
      managed.panel.killAgent();
      this.emitLifecycle({
        type: 'exited',
        panelIndex,
        sessionId: managed.sessionId,
        agentType: managed.type,
        agentName: managed.info.name,
      });
      this.agents.delete(panelIndex);
      logger.info(`Agent manager: killed agent on panel ${panelIndex}`);
    }
  }

  killAll(): void {
    for (const [idx, managed] of this.agents) {
      managed.panel.killAgent();
      this.emitLifecycle({
        type: 'exited',
        panelIndex: idx,
        sessionId: managed.sessionId,
        agentType: managed.type,
        agentName: managed.info.name,
      });
    }
    this.agents.clear();
    logger.info('Agent manager: killed all agents');
  }

  reindexAfterPanelRemoval(removedPanelIndex: number): void {
    const reindexed = new Map<number, ManagedAgent>();
    for (const [panelIndex, managed] of this.agents) {
      if (panelIndex === removedPanelIndex) continue;
      const nextIndex = panelIndex > removedPanelIndex ? panelIndex - 1 : panelIndex;
      reindexed.set(nextIndex, managed);
    }
    this.agents = reindexed;
  }

  getRunningAgents(): RunningAgentInfo[] {
    const result: RunningAgentInfo[] = [];
    const now = new Date().getTime();

    for (const [idx, managed] of this.agents) {
      if (!managed.panel.isRunning) {
        // Stale entry cleanup (though onExit should handle most cases)
        this.agents.delete(idx);
        continue;
      }

      result.push({
        panelIndex: idx,
        sessionId: managed.sessionId,
        type: managed.type,
        name: managed.info.name,
        status: managed.panel.status,
        uptime: Math.floor((now - managed.launchedAt.getTime()) / 1000),
      });
    }
    return result;
  }

  isAgentRunning(panelIndex: number): boolean {
    const managed = this.agents.get(panelIndex);
    return managed?.panel.isRunning ?? false;
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

  private makeSessionId(agentType: AgentType, panelIndex: number): string {
    const seq = this.sessionSeq++;
    return `${agentType}_${(panelIndex + 1).toString(36)}_${Date.now().toString(36)}_${seq.toString(36)}`;
  }
}
