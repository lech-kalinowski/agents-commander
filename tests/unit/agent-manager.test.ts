import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentManager } from '../../src/agents/agent-manager.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentManager', () => {
  it('filters out stale agents and removes them from the registry', () => {
    const manager = new AgentManager() as any;
    const now = new Date();

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI' },
      panel: { isRunning: true, status: 'running' },
      launchedAt: new Date(now.getTime() - 6000),
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

  it('keeps crashed agents registered while an auto-restart is pending', async () => {
    vi.useFakeTimers();
    const manager = new AgentManager() as any;
    const mockPanel = {
      panelIndex: 0,
      isRunning: false,
      status: 'error',
      workingDir: '/tmp',
      launchAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(),
    };

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI', args: [] },
      panel: mockPanel,
      launchedAt: new Date(Date.now() - 6000),
      restartCount: 0,
      sessionId: 'codex-session-0',
    });

    // Simulate crash (exit code 1)
    manager.handleAgentExit(0, 1, null);

    expect(manager.agents.get(0).restartCount).toBe(1);
    expect(manager.getRunningAgents()).toEqual([
      expect.objectContaining({ panelIndex: 0, status: 'restarting' }),
    ]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockPanel.launchAgent).toHaveBeenCalled();
  });

  it('cancels a pending restart when the agent is killed', async () => {
    vi.useFakeTimers();
    const manager = new AgentManager() as any;
    const mockPanel = {
      panelIndex: 0,
      isRunning: false,
      status: 'error',
      workingDir: '/tmp',
      launchAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(),
    };

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI', args: [] },
      panel: mockPanel,
      launchedAt: new Date(Date.now() - 6000),
      restartCount: 0,
      sessionId: 'codex-session-0',
      restartTimer: null,
    });

    manager.handleAgentExit(0, 1, null);
    expect(manager.hasAgent(0)).toBe(true);
    manager.killAgent(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockPanel.launchAgent).not.toHaveBeenCalled();
    expect(manager.hasAgent(0)).toBe(false);
    expect(manager.agents.has(0)).toBe(false);
  });

  it('uses configured commands, arguments, and environment variables', () => {
    const manager = new AgentManager({
      generic: {
        command: process.execPath,
        args: ['--version'],
        env: { AGENTS_COMMANDER_TEST: '1' },
      },
    });
    const mockPanel = {
      panelIndex: 0,
      isRunning: false,
      workingDir: '/tmp',
      launchAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(),
      status: 'idle',
      onExit: null,
    };

    expect(manager.launchAgent('generic', mockPanel as never)).toBe(true);
    expect(mockPanel.launchAgent).toHaveBeenCalledWith(
      'generic',
      'Shell',
      process.execPath,
      ['--version'],
      { AGENTS_COMMANDER_TEST: '1' },
    );
  });

  it('registers a scanner-enabled internal agent with role identity and no restart', async () => {
    vi.useFakeTimers();
    const manager = new AgentManager();
    const lifecycle = vi.fn();
    manager.onLifecycle(lifecycle);
    const mockPanel = {
      panelIndex: 1,
      isRunning: false,
      workingDir: '/tmp/demo',
      launchInternalAgent: vi.fn().mockImplementation(() => {
        mockPanel.isRunning = true;
        mockPanel.status = 'running';
        return true;
      }),
      killAgent: vi.fn(),
      status: 'running',
      onExit: null as ((
        code: number | null,
        signal: string | null,
        reason?: 'process-exit' | 'spawn-error',
      ) => void) | null,
    };

    expect(manager.launchInternalAgent({
      name: 'Demo Reviewer',
      command: process.execPath,
      args: ['/demo/demo-agent.js', '--role', 'reviewer'],
      env: { LANG: 'C' },
    }, mockPanel as never)).toBe(true);

    expect(mockPanel.launchInternalAgent).toHaveBeenCalledWith(
      'Demo Reviewer',
      process.execPath,
      ['/demo/demo-agent.js', '--role', 'reviewer'],
      { LANG: 'C' },
    );
    const running = manager.getRunningAgents();
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({
      panelIndex: 1,
      type: 'generic',
      name: 'Demo Reviewer',
      status: 'running',
    });
    expect(running[0].sessionId).toMatch(/^generic_2_/);
    expect(manager.getAgentType(1)).toBe('generic');
    expect(manager.getAgentSessionId(1)).toBe(running[0].sessionId);
    expect(manager.findPanelBySessionId(running[0].sessionId)).toBe(1);
    expect(lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      type: 'launched',
      panelIndex: 1,
      sessionId: running[0].sessionId,
      agentType: 'generic',
      agentName: 'Demo Reviewer',
    }));

    mockPanel.isRunning = false;
    mockPanel.status = 'exited';
    mockPanel.onExit?.(0, null);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockPanel.launchInternalAgent).toHaveBeenCalledTimes(1);
    expect(manager.hasAgent(1)).toBe(false);
    expect(lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      type: 'exited',
      panelIndex: 1,
      sessionId: running[0].sessionId,
      agentName: 'Demo Reviewer',
      exitCode: 0,
      signal: null,
      reason: 'process-exit',
    }));
  });

  it('preserves an asynchronous spawn-error reason with null exit metadata', () => {
    const manager = new AgentManager();
    const lifecycle = vi.fn();
    manager.onLifecycle(lifecycle);
    const mockPanel = {
      panelIndex: 0,
      isRunning: false,
      workingDir: '/tmp/demo',
      launchInternalAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(async () => undefined),
      status: 'error',
      onExit: null as ((
        code: number | null,
        signal: string | null,
        reason: 'process-exit' | 'spawn-error',
      ) => void) | null,
    };

    expect(manager.launchInternalAgent({
      name: 'Demo Coordinator',
      command: process.execPath,
    }, mockPanel as never)).toBe(true);
    mockPanel.onExit?.(null, null, 'spawn-error');

    expect(lifecycle).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'exited',
      panelIndex: 0,
      exitCode: null,
      signal: null,
      reason: 'spawn-error',
    }));
    expect(manager.hasAgent(0)).toBe(false);
  });

  it('irreversibly rejects launches after shutdown preparation begins', () => {
    const manager = new AgentManager();
    const mockPanel = {
      panelIndex: 0,
      isRunning: false,
      workingDir: '/tmp',
      launchAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(async () => undefined),
      status: 'idle',
      onExit: null,
    };

    expect(manager.prepareForShutdown()).toEqual([]);
    expect(manager.launchAgent('generic', mockPanel as never)).toBe(false);
    expect(mockPanel.launchAgent).not.toHaveBeenCalled();
  });

  it('does not replace a managed session for an invalid internal launch spec', () => {
    const manager = new AgentManager() as any;
    const mockPanel = {
      panelIndex: 0,
      isRunning: true,
      launchInternalAgent: vi.fn(),
      killAgent: vi.fn(),
    };
    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI' },
      panel: mockPanel,
      launchedAt: new Date(),
      restartCount: 0,
      sessionId: 'existing',
      restartTimer: null,
      autoRestart: true,
    });

    expect(manager.launchInternalAgent({
      name: ' ',
      command: process.execPath,
    }, mockPanel as never)).toBe(false);
    expect(manager.getAgentSessionId(0)).toBe('existing');
    expect(mockPanel.killAgent).not.toHaveBeenCalled();
    expect(mockPanel.launchInternalAgent).not.toHaveBeenCalled();
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
      launchedAt: new Date(Date.now() - 6000),
      restartCount: 3, // Max limit
      sessionId: 'codex-session-0',
    });

    // Simulate another crash
    manager.handleAgentExit(0, 1, null);

    // Should have removed the agent from the map
    expect(manager.agents.has(0)).toBe(false);
    expect(mockPanel.launchAgent).not.toHaveBeenCalled();
  });

  it('does not restart a process that fails during startup', async () => {
    vi.useFakeTimers();
    const manager = new AgentManager() as any;
    const mockPanel = {
      panelIndex: 0,
      isRunning: false,
      status: 'error',
      workingDir: '/tmp',
      launchAgent: vi.fn().mockReturnValue(true),
      killAgent: vi.fn(),
    };

    manager.agents.set(0, {
      type: 'codex',
      info: { name: 'Codex CLI', args: ['--invalid'] },
      panel: mockPanel,
      launchedAt: new Date(),
      restartCount: 0,
      sessionId: 'codex-session-0',
      restartTimer: null,
    });

    manager.handleAgentExit(0, 2, null);
    await vi.advanceTimersByTimeAsync(2000);

    expect(mockPanel.launchAgent).not.toHaveBeenCalled();
    expect(manager.hasAgent(0)).toBe(false);
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
