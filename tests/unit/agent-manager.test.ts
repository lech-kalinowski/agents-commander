import { describe, expect, it, vi } from 'vitest';
import { AgentManager } from '../../src/agents/agent-manager.js';

describe('AgentManager', () => {
  it('filters out stale agents and removes them from the registry', () => {
    const manager = new AgentManager() as any;
    const now = new Date();

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI' },
      panel: { isRunning: true, status: 'running' },
      launchedAt: now,
      restartCount: 0,
      sessionId: 'codex-session-0',
    });
    manager.agents.set(1, {
      type: 'claude',
      info: { name: 'Claude Code' },
      panel: { isRunning: false, status: 'exited' },
      launchedAt: now,
      restartCount: 0,
      sessionId: 'claude-session-1',
    });

    const running = manager.getRunningAgents();
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({
      panelIndex: 0,
      type: 'codex',
      name: 'Codex CLI',
      status: 'running',
    });
    expect(running[0].uptime).toBeDefined();
    expect(manager.agents.has(1)).toBe(false);
  });

  it('handles agent crashes with auto-restart', async () => {
    const manager = new AgentManager() as any;
    const mockPanel = {
      panelIndex: 0,
      isRunning: true,
      workingDir: '/tmp',
      launchAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(),
    };

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI', args: [] },
      panel: mockPanel,
      launchedAt: new Date(),
      restartCount: 0,
      sessionId: 'codex-session-0',
    });

    // Simulate crash (exit code 1)
    manager.handleAgentExit(0, 1, null);

    // Should have incremented restart count
    expect(manager.agents.get(0).restartCount).toBe(1);
    
    // performLaunch should be called after a delay
    await new Promise(r => setTimeout(r, 1100));
    expect(mockPanel.launchAgent).toHaveBeenCalled();
  });

  it('stops restarting after reaching max limit', () => {
    const manager = new AgentManager() as any;
    const mockPanel = {
      panelIndex: 0,
      isRunning: true,
      workingDir: '/tmp',
      launchAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(),
    };

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI', args: [] },
      panel: mockPanel,
      launchedAt: new Date(),
      restartCount: 3, // Max limit
      sessionId: 'codex-session-0',
    });

    // Simulate another crash
    manager.handleAgentExit(0, 1, null);

    // Should have removed the agent from the map
    expect(manager.agents.has(0)).toBe(false);
    expect(mockPanel.launchAgent).not.toHaveBeenCalled();
  });

  it('reindexes agents after a panel is removed', () => {
    const manager = new AgentManager() as any;
    const now = new Date();

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI' },
      panel: { isRunning: true, status: 'running', panelIndex: 0 },
      launchedAt: now,
      restartCount: 0,
      sessionId: 'codex-session-0',
    });
    manager.agents.set(2, {
      type: 'claude',
      info: { name: 'Claude Code' },
      panel: { isRunning: true, status: 'running', panelIndex: 1 },
      launchedAt: now,
      restartCount: 0,
      sessionId: 'claude-session-2',
    });

    manager.reindexAfterPanelRemoval(1);

    expect([...manager.agents.keys()]).toEqual([0, 1]);
    const running = manager.getRunningAgents();
    expect(running).toHaveLength(2);
    expect(running[0].panelIndex).toBe(0);
    expect(running[1].panelIndex).toBe(1);
  });
});
