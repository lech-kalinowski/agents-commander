import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommanderMessage } from '../../src/orchestration/protocol.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';

// ── Helpers ──────────────────────────────────────────────────────

/** Create a mock TerminalPanel with sendInput tracking. */
function mockTerminalPanel(panelIndex: number, isRunning = true) {
  const inputs: string[] = [];
  const panel = {
    panelIndex,
    isRunning,
    sendInput: vi.fn((text: string) => inputs.push(text)),
    muteScanner: vi.fn(),
    unmuteScanner: vi.fn(),
    markProtocolTextAsProcessed: vi.fn(),
    reserveProtocolTextForEcho: vi.fn(),
    snapshotVisibleProtocolAsProcessed: vi.fn(),
    showCommanderActivity: vi.fn(),
    updatePanelIndex: vi.fn((nextIndex: number) => { panel.panelIndex = nextIndex; }),
    onCommanderMessage: null as any,
    onUserInput: null as any,
    killAgent: vi.fn(),
    _inputs: inputs,
  };
  return panel;
}

/** Create a mock LayoutManager. */
function mockLayout(panels: Record<number, ReturnType<typeof mockTerminalPanel>> = {}) {
  return {
    panelCount: Object.keys(panels).length || 2,
    getTerminalPanel: vi.fn((idx: number) => panels[idx] ?? null),
    convertToTerminal: vi.fn(),
    addPanel: vi.fn(async () => true),
    setActivePanel: vi.fn(),
  };
}

/** Create a mock AgentManager. */
function mockAgentManager(agentTypes: Record<number, string> = {}) {
  const runningAgents = () =>
    Object.entries(agentTypes).map(([idx, type]) => ({
      panelIndex: Number(idx),
      sessionId: `${type}-session-${idx}`,
      type,
      name: type === 'claude' ? 'Claude Code' : type === 'codex' ? 'Codex CLI' : type === 'gemini' ? 'Gemini CLI' : type,
      status: 'running',
      uptime: 0,
    }));

  return {
    getAgentType: vi.fn((panelIndex: number) => agentTypes[panelIndex] ?? null),
    getRunningAgents: vi.fn(runningAgents),
    getAgentSessionId: vi.fn((panelIndex: number) => {
      const agent = runningAgents().find((entry) => entry.panelIndex === panelIndex);
      return agent?.sessionId ?? null;
    }),
    findPanelBySessionId: vi.fn((sessionId: string) => {
      const agent = runningAgents().find((entry) => entry.sessionId === sessionId);
      return agent?.panelIndex ?? null;
    }),
    onLifecycle: vi.fn(() => () => {}),
    launchAgent: vi.fn(() => true),
    killAgent: vi.fn(),
  };
}

describe('Orchestrator', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── SEND routing ────────────────────────────────────────────────

  it('records the original source agent when routing SEND messages', () => {
    const agents = mockAgentManager({ 0: 'codex', 1: 'claude' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;
    orchestrator.enqueueTask = vi.fn();

    const msg: CommanderMessage = {
      type: 'send',
      sourcePanel: 0,
      sourceAgent: 'Codex CLI',
      targetAgent: 'claude',
      targetPanel: 1,
      content: 'Please review this change',
    };

    orchestrator.handleAgentMessage(msg);

    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(1, {
      agentType: 'claude',
      task: expect.stringContaining('Please review this change'),
      source: {
        panel: 0,
        sessionId: 'codex-session-0',
        agent: 'Codex CLI',
        agentType: 'codex',
      },
      directType: true,
      kind: 'send',
      messageId: expect.stringMatching(/^msg_/),
      threadId: expect.stringMatching(/^thr_/),
    });
  });

  // ── REPLY routing ───────────────────────────────────────────────

  it('routes REPLY through the latest open thread for the replying session', () => {
    const agents = mockAgentManager({ 0: 'claude', 1: 'codex' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;
    orchestrator.enqueueTask = vi.fn();

    orchestrator.ledger.openReplyWindow({
      threadId: 'thr_existing',
      replyToMessageId: 'msg_existing',
      waitingOnSessionId: 'codex-session-1',
      returnToSessionId: 'claude-session-0',
      returnToAgentName: 'Claude Code',
      returnToAgentType: 'claude',
    });

    const msg: CommanderMessage = {
      type: 'reply',
      sourcePanel: 1,
      sourceAgent: 'Codex CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'Tests written. 12 passing.',
    };

    orchestrator.handleAgentMessage(msg);

    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(0, {
      agentType: 'claude',
      task: expect.stringContaining('Tests written. 12 passing.'),
      source: {
        panel: 1,
        sessionId: 'codex-session-1',
        agent: 'Codex CLI',
        agentType: 'codex',
      },
      directType: true,
      kind: 'reply',
      messageId: expect.stringMatching(/^msg_/),
      threadId: 'thr_existing',
      replyToMessageId: 'msg_existing',
      claimedReplyRoute: expect.objectContaining({
        waitingOnSessionId: 'codex-session-1',
        returnToSessionId: 'claude-session-0',
      }),
    });
  });

  it('drops REPLY when there is no previous sender', () => {
    const agents = mockAgentManager({ 1: 'codex' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;
    orchestrator.enqueueTask = vi.fn();

    const msg: CommanderMessage = {
      type: 'reply',
      sourcePanel: 1,
      sourceAgent: 'Codex CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'No one asked me',
    };

    orchestrator.handleAgentMessage(msg);

    expect(orchestrator.enqueueTask).not.toHaveBeenCalled();
  });

  // ── BROADCAST routing ───────────────────────────────────────────

  it('broadcasts to all connected panels except source', () => {
    const tp0 = mockTerminalPanel(0);
    const tp1 = mockTerminalPanel(1);
    const tp2 = mockTerminalPanel(2);
    const layout = mockLayout({ 0: tp0, 1: tp1, 2: tp2 });
    const agents = mockAgentManager({ 0: 'claude', 1: 'codex', 2: 'gemini' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;

    orchestrator.connectedPanels = new Set([0, 1, 2]);
    orchestrator.enqueueTask = vi.fn();

    const msg: CommanderMessage = {
      type: 'broadcast',
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'Begin phase 2',
    };

    orchestrator.handleAgentMessage(msg);

    // Should enqueue to panels 1 and 2, not panel 0
    expect(orchestrator.enqueueTask).toHaveBeenCalledTimes(2);
    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(1, expect.objectContaining({
      agentType: 'codex',
      task: expect.stringContaining('Begin phase 2'),
    }));
    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(2, expect.objectContaining({
      agentType: 'gemini',
      task: expect.stringContaining('Begin phase 2'),
    }));
  });

  it('sends combined ACK for broadcast (not per-target)', () => {
    const tp0 = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp0, 1: mockTerminalPanel(1), 2: mockTerminalPanel(2) });
    const agents = mockAgentManager({ 0: 'codex', 1: 'claude', 2: 'gemini' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;

    orchestrator.connectedPanels = new Set([0, 1, 2]);
    orchestrator.enqueueTask = vi.fn();

    const msg: CommanderMessage = {
      type: 'broadcast',
      sourcePanel: 0,
      sourceAgent: 'Codex CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'Test',
    };

    orchestrator.handleAgentMessage(msg);

    // Source panel (0) should receive exactly ONE ACK with both target names
    expect(tp0.sendInput).toHaveBeenCalledTimes(1);
    const ackCall = tp0.sendInput.mock.calls[0][0];
    expect(ackCall).toContain('kind=broadcast');
    expect(ackCall).toContain('queued=2');
    expect(ackCall).toContain('Claude Code');
    expect(ackCall).toContain('Gemini CLI');
  });

  // ── STATUS handling ─────────────────────────────────────────────

  it('shows STATUS as toast, acknowledges it locally, and does not send to any agent', () => {
    const tp0 = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp0 });
    const agents = mockAgentManager({ 0: 'claude' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.enqueueTask = vi.fn();

    const msg: CommanderMessage = {
      type: 'status',
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'Analyzing file 5 of 10',
    };

    orchestrator.handleAgentMessage(msg);

    // STATUS should NOT enqueue any tasks
    expect(orchestrator.enqueueTask).not.toHaveBeenCalled();
    expect(tp0.sendInput).toHaveBeenCalledTimes(1);
    expect(tp0.sendInput.mock.calls[0][0]).toContain('kind=status');
    expect(tp0.sendInput.mock.calls[0][0]).toContain('status=accepted');
  });

  // ── QUERY handling ──────────────────────────────────────────────

  it('responds to QUERY with list of running agents', () => {
    const tp0 = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp0 });
    const agents = mockAgentManager({ 0: 'claude', 1: 'codex' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;

    const msg: CommanderMessage = {
      type: 'query',
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'agents',
    };

    orchestrator.handleAgentMessage(msg);

    // Should send response back to the querying panel
    expect(tp0.sendInput).toHaveBeenCalled();
    const response = tp0.sendInput.mock.calls[0][0];
    expect(response).toContain('Running agents');
  });

  // ── Claude-specific sendInfoToPanel ─────────────────────────────

  it('types ACK directly to Claude (no bracketed paste)', () => {
    const tp = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp });
    const agents = mockAgentManager({ 0: 'claude' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;

    orchestrator.sendInfoToPanel(0, '[Commander] Test ACK');

    expect(tp.muteScanner).not.toHaveBeenCalled();

    // Should type directly — no paste markers, text + \r in one call
    expect(tp.sendInput).toHaveBeenCalledTimes(1);
    const sent = tp.sendInput.mock.calls[0][0];
    expect(sent).toBe('[Commander] Test ACK\r');
    expect(sent).not.toContain('\x1b[200~'); // no paste start
    expect(sent).not.toContain('\x1b[201~'); // no paste end
  });

  it('flattens multi-line text when typing to Claude', () => {
    const tp = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp });
    const agents = mockAgentManager({ 0: 'claude' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;

    orchestrator.sendInfoToPanel(0, '[Commander] Running agents:\n  Panel 1: Claude\n  Panel 2: Codex');

    const sent = tp.sendInput.mock.calls[0][0];
    // Newlines replaced with spaces
    expect(sent).toBe('[Commander] Running agents:   Panel 1: Claude   Panel 2: Codex\r');
    expect(sent).not.toContain('\n');
  });

  it('sends atomic paste+Enter to non-Claude agents', () => {
    const tp = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp });
    const agents = mockAgentManager({ 0: 'codex' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;

    orchestrator.sendInfoToPanel(0, '[Commander] Test ACK');

    expect(tp.muteScanner).not.toHaveBeenCalled();

    // Paste + \r should be in ONE call (atomic)
    expect(tp.sendInput).toHaveBeenCalledTimes(1);
    const paste = tp.sendInput.mock.calls[0][0];
    expect(paste).toBe('\x1b[200~[Commander] Test ACK\x1b[201~\r');
  });

  // ── submitInput ─────────────────────────────────────────────────

  it('sends Enter after 2.5s delay for Claude (bypass prompt needs time)', async () => {
    vi.useFakeTimers();

    const tp = mockTerminalPanel(0);
    const agents = mockAgentManager({ 0: 'claude' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;

    const promise = orchestrator.submitInput(tp);

    // Not sent yet at 1s
    await vi.advanceTimersByTimeAsync(1000);
    expect(tp.sendInput).not.toHaveBeenCalled();

    // Sent after 2.5s total
    await vi.advanceTimersByTimeAsync(1500);
    expect(tp.sendInput).toHaveBeenCalledTimes(1);
    expect(tp.sendInput.mock.calls[0][0]).toBe('\r');

    await promise;
  });

  it('sends Enter after 100ms for non-Claude agents', async () => {
    vi.useFakeTimers();

    const tp = mockTerminalPanel(0);
    const agents = mockAgentManager({ 0: 'codex' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;

    const promise = orchestrator.submitInput(tp);

    await vi.advanceTimersByTimeAsync(100);
    expect(tp.sendInput).toHaveBeenCalledTimes(1);
    expect(tp.sendInput.mock.calls[0][0]).toBe('\r');

    await promise;
  });

  // ── Post-injection handling ─────────────────────────────────────

  it('does not ignore QUERY immediately after protocol injection state exists', () => {
    const tp = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp });
    const agents = mockAgentManager({ 0: 'codex' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.injectionGrace.set(0, Date.now() + 2500);
    orchestrator.protocolSessionState.set('codex-session-0', {
      injectedAt: Date.now(),
      engaged: false,
      lastUserInputAt: 0,
    });

    orchestrator.handleAgentMessage({
      type: 'query',
      sourcePanel: 0,
      sourceAgent: 'Codex CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'agents',
    } as CommanderMessage);

    expect(tp.sendInput).toHaveBeenCalled();
  });

  it('suppresses unsolicited startup broadcast chatter before the session is engaged', () => {
    const tp0 = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp0, 1: mockTerminalPanel(1) });
    const agents = mockAgentManager({ 0: 'gemini', 1: 'claude' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.connectedPanels = new Set([0, 1]);
    orchestrator.enqueueTask = vi.fn();
    orchestrator.protocolSessionState.set('gemini-session-0', {
      injectedAt: Date.now(),
      engaged: false,
      lastUserInputAt: 0,
    });

    orchestrator.handleAgentMessage({
      type: 'broadcast',
      sourcePanel: 0,
      sourceAgent: 'Gemini CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'Hello, I am ready to collaborate.',
    } as CommanderMessage);

    expect(orchestrator.enqueueTask).not.toHaveBeenCalled();
    expect(tp0.sendInput).not.toHaveBeenCalled();
  });

  it('suppresses startup status queries until the session is engaged', () => {
    const tp0 = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp0 });
    const agents = mockAgentManager({ 0: 'gemini' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.protocolSessionState.set('gemini-session-0', {
      injectedAt: Date.now(),
      engaged: false,
      lastUserInputAt: 0,
    });

    orchestrator.handleAgentMessage({
      type: 'query',
      sourcePanel: 0,
      sourceAgent: 'Gemini CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'status',
    } as CommanderMessage);

    expect(tp0.sendInput).not.toHaveBeenCalled();
  });

  it('allows startup SEND after real user input engages the session', () => {
    const tp0 = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp0, 1: mockTerminalPanel(1) });
    const agents = mockAgentManager({ 0: 'claude', 1: 'codex' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.connectedPanels = new Set([0, 1]);
    orchestrator.enqueueTask = vi.fn();
    orchestrator.protocolSessionState.set('claude-session-0', {
      injectedAt: Date.now(),
      engaged: false,
      lastUserInputAt: 0,
    });

    orchestrator.markPanelUserEngaged(0);
    orchestrator.handleAgentMessage({
      type: 'send',
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'codex',
      targetPanel: 1,
      content: 'Please confirm receipt.',
    } as CommanderMessage);

    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(1, expect.objectContaining({
      agentType: 'codex',
      task: expect.stringContaining('Please confirm receipt.'),
    }));
  });

  it('treats successful Commander-delivered tasks as session engagement for the first SEND', async () => {
    const tp0 = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp0, 1: mockTerminalPanel(1) });
    const agents = mockAgentManager({ 0: 'claude', 1: 'codex' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.connectedPanels = new Set([0, 1]);
    orchestrator.executeTask = vi.fn(async () => ({ success: true }));
    orchestrator.protocolSessionState.set('claude-session-0', {
      injectedAt: Date.now(),
      engaged: false,
      lastUserInputAt: 0,
    });

    await expect(orchestrator.sendTask('claude', 0, 'User-selected collaboration template')).resolves.toEqual({
      success: true,
    });

    expect(orchestrator.protocolSessionState.get('claude-session-0')).toMatchObject({ engaged: true });

    orchestrator.enqueueTask = vi.fn();
    orchestrator.handleAgentMessage({
      type: 'send',
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'codex',
      targetPanel: 1,
      content: 'Open the collaboration thread.',
    } as CommanderMessage);

    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(1, expect.objectContaining({
      agentType: 'codex',
      task: expect.stringContaining('Open the collaboration thread.'),
    }));
  });

  it('snapshots visible protocol text after injection instead of arming a drop window', async () => {
    vi.useFakeTimers();

    const tp = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp });
    const agents = mockAgentManager({ 0: 'codex', 1: 'claude' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.sendTextToAgent = vi.fn(async () => {});
    orchestrator.submitInput = vi.fn(async () => {});

    const injectPromise = orchestrator.injectProtocol(tp);
    await vi.advanceTimersByTimeAsync(200);
    await injectPromise;

    expect(tp.markProtocolTextAsProcessed).toHaveBeenCalled();
    expect(tp.snapshotVisibleProtocolAsProcessed).toHaveBeenCalled();
    expect(orchestrator.injectionGrace.has(0)).toBe(false);
  });

  // ── Task queue ──────────────────────────────────────────────────

  it('times out queued tasks after 60 seconds', async () => {
    vi.useFakeTimers();

    const orchestrator = new Orchestrator({} as never, {} as never) as any;
    orchestrator.cancelQueuedTask = vi.fn(() => true);
    orchestrator.enqueueTask = vi.fn(() => ({
      id: 1,
      agentType: 'codex',
      task: 'Do work',
      started: false,
      cancelled: false,
      queuedAt: Date.now(),
    }));

    const promise = orchestrator.sendTask('codex', 0, 'Do work');
    await vi.advanceTimersByTimeAsync(60000);

    await expect(promise).resolves.toEqual({
      success: false,
      error: 'Task queue timed out after 60000ms',
    });
    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(0, expect.objectContaining({
      agentType: 'codex',
      task: 'Do work',
    }));
  });

  it('removes a timed-out task if it is still waiting in the queue', async () => {
    vi.useFakeTimers();

    const orchestrator = new Orchestrator({} as never, {} as never) as any;
    const queueState = {
      tasks: [],
      processing: true,
      currentTask: null,
      detachedReason: null,
    };
    orchestrator.panelQueues.set(0, queueState);
    orchestrator.panelProcessing = new Set([0]);

    const promise = orchestrator.sendTask('codex', 0, 'Do work');
    expect(queueState.tasks).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60000);

    await expect(promise).resolves.toEqual({
      success: false,
      error: 'Task queue timed out after 60000ms',
    });
    expect(queueState.tasks).toHaveLength(0);
  });

  it('reports a running task instead of canceling it after 60 seconds', async () => {
    vi.useFakeTimers();

    const orchestrator = new Orchestrator({} as never, {} as never) as any;
    orchestrator.executeTask = vi.fn(() => new Promise(() => {}));

    const promise = orchestrator.sendTask('codex', 0, 'Do work');
    await Promise.resolve();

    const queueState = orchestrator.panelQueues.get(0);
    expect(queueState.currentTask?.task).toBe('Do work');

    await vi.advanceTimersByTimeAsync(60000);

    await expect(promise).resolves.toEqual({
      success: false,
      error: 'Task is still in progress after 60000ms',
    });
    expect(queueState.currentTask?.task).toBe('Do work');
  });

  it('returns the actual queued task result instead of reporting generic success', async () => {
    const orchestrator = new Orchestrator({} as never, {} as never) as any;
    orchestrator.enqueueTask = vi.fn((_panelIndex: number, task: any) => {
      task.onComplete?.({ success: false, error: 'launch failed' });
    });

    await expect(orchestrator.sendTask('codex', 0, 'Do work')).resolves.toEqual({
      success: false,
      error: 'launch failed',
    });
  });

  it('queues manual sends even when the panel is idle', async () => {
    const orchestrator = new Orchestrator({} as never, {} as never) as any;
    orchestrator.executeTask = vi.fn();
    orchestrator.enqueueTask = vi.fn((_panelIndex: number, queuedTask: any) => {
      queuedTask.onComplete?.({ success: true });
    });

    await expect(orchestrator.sendTask('codex', 1, 'Do work')).resolves.toEqual({ success: true });
    expect(orchestrator.enqueueTask).toHaveBeenCalledWith(1, expect.objectContaining({
      agentType: 'codex',
      task: 'Do work',
    }));
    expect(orchestrator.executeTask).not.toHaveBeenCalled();
  });

  it('reindexes routing state after a panel is removed', () => {
    const agents = mockAgentManager({ 0: 'claude', 2: 'gemini', 3: 'codex' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;
    orchestrator.connectedPanels = new Set([0, 1, 2, 3]);
    orchestrator.protocolInjected = new Set([1, 2, 3]);
    orchestrator.panelQueues = new Map([
      [1, {
        tasks: [{
          id: 1,
          agentType: 'codex',
          task: 'drop me',
          source: { panel: 1, sessionId: 'removed-session', agent: 'Claude Code', agentType: 'claude' },
          started: false,
          cancelled: false,
          queuedAt: 0,
        }],
        processing: false,
        currentTask: null,
        detachedReason: null,
      }],
      [2, {
        tasks: [{
          id: 2,
          agentType: 'gemini',
          task: 'keep me',
          source: { panel: 3, sessionId: 'codex-session-3', agent: 'Codex CLI', agentType: 'codex' },
          started: false,
          cancelled: false,
          queuedAt: 0,
        }],
        processing: true,
        currentTask: {
          id: 3,
          agentType: 'gemini',
          task: 'running',
          source: { panel: 3, sessionId: 'codex-session-3', agent: 'Codex CLI', agentType: 'codex' },
          started: true,
          cancelled: false,
          queuedAt: 0,
        },
        detachedReason: null,
      }],
    ]);
    orchestrator.panelProcessing = new Set([2]);
    orchestrator.injectionGrace = new Map([[1, 10], [3, 20]]);

    orchestrator.reindexAfterPanelRemoval(1);

    expect([...orchestrator.connectedPanels]).toEqual([0, 1, 2]);
    expect([...orchestrator.protocolInjected]).toEqual([1, 2]);
    expect([...orchestrator.panelProcessing]).toEqual([1]);
    expect(orchestrator.panelQueues.has(1)).toBe(true);
    expect(orchestrator.panelQueues.get(1)).toMatchObject({
      tasks: [
        {
          agentType: 'gemini',
          task: 'keep me',
          source: { panel: 2, sessionId: 'codex-session-3', agent: 'Codex CLI', agentType: 'codex' },
        },
      ],
      processing: true,
      currentTask: {
        task: 'running',
        source: { panel: 2, sessionId: 'codex-session-3', agent: 'Codex CLI', agentType: 'codex' },
      },
    });
    expect([...orchestrator.injectionGrace.entries()]).toEqual([[2, 20]]);
  });

  it('continues processing queued tasks after one task throws', async () => {
    const orchestrator = new Orchestrator({} as never, {} as never) as any;
    const results: Array<{ success: boolean; error?: string }> = [];
    orchestrator.executeTask = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ success: true });

    orchestrator.enqueueTask(0, {
      agentType: 'codex',
      task: 'first',
      onComplete: (result: { success: boolean; error?: string }) => results.push(result),
    });
    orchestrator.enqueueTask(0, {
      agentType: 'codex',
      task: 'second',
      onComplete: (result: { success: boolean; error?: string }) => results.push(result),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(results).toEqual([
      { success: false, error: 'boom' },
      { success: true },
    ]);
    expect(orchestrator.panelProcessing.has(0)).toBe(false);
    expect(orchestrator.panelQueues.has(0)).toBe(false);
  });

  // ── executeTask delivery path ──────────────────────────────────

  it('types short Claude tasks directly and submits them after a short delay', async () => {
    const tp = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp });
    const agents = mockAgentManager({ 0: 'claude' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.delay = vi.fn(async () => {});
    orchestrator.sendTextChunked = vi.fn(async () => {});
    orchestrator.sendTextToAgent = vi.fn(async () => {});
    orchestrator.submitInput = vi.fn(async () => {});

    await expect(orchestrator.executeTask('claude', 0, 'Short routed reply', true)).resolves.toEqual({
      success: true,
    });

    expect(tp.reserveProtocolTextForEcho).toHaveBeenCalledWith('Short routed reply');
    expect(orchestrator.sendTextChunked).toHaveBeenCalledWith(tp, 'Short routed reply');
    expect(orchestrator.delay).toHaveBeenCalled();
    expect(tp.sendInput).toHaveBeenCalledWith('\r');
    expect(tp.showCommanderActivity).toHaveBeenCalledWith('Commander task received');
    expect(orchestrator.sendTextToAgent).not.toHaveBeenCalled();
    expect(orchestrator.submitInput).not.toHaveBeenCalled();
  });

  it('uses paste fallback for long Claude tasks so routed replies are actually submitted', async () => {
    const tp = mockTerminalPanel(0);
    const layout = mockLayout({ 0: tp });
    const agents = mockAgentManager({ 0: 'claude' });
    const orchestrator = new Orchestrator(layout as any, agents as any) as any;
    orchestrator.sendTextChunked = vi.fn(async () => {});
    orchestrator.sendTextToAgent = vi.fn(async () => {});
    orchestrator.submitInput = vi.fn(async () => {});

    const longReply = 'I partly disagree. '.repeat(30);
    await expect(orchestrator.executeTask('claude', 0, longReply, true)).resolves.toEqual({
      success: true,
    });

    expect(tp.reserveProtocolTextForEcho).toHaveBeenCalledWith(longReply);
    expect(orchestrator.sendTextToAgent).toHaveBeenCalledWith(tp, longReply);
    expect(orchestrator.submitInput).toHaveBeenCalledWith(tp);
    expect(tp.showCommanderActivity).toHaveBeenCalledWith('Commander task received');
    expect(orchestrator.sendTextChunked).not.toHaveBeenCalled();
  });

  // ── sendTextToAgent ──────────────────────────────────────────────

  it('wraps text in bracketed paste for all agents', async () => {
    const tp = mockTerminalPanel(0);
    const agents = mockAgentManager({ 0: 'codex' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;

    await orchestrator.sendTextToAgent(tp, 'Hello world');

    // Should send: paste-start, text, paste-end
    expect(tp.sendInput).toHaveBeenCalledTimes(3);
    expect(tp.sendInput.mock.calls[0][0]).toBe('\x1b[200~');
    expect(tp.sendInput.mock.calls[1][0]).toBe('Hello world');
    expect(tp.sendInput.mock.calls[2][0]).toBe('\x1b[201~');
  });

  it('chunks large text to avoid PTY buffer overflow', async () => {
    vi.useFakeTimers();

    const tp = mockTerminalPanel(0);
    const agents = mockAgentManager({ 0: 'codex' });
    const orchestrator = new Orchestrator({} as never, agents as any) as any;

    const largeText = 'X'.repeat(3000); // > 1024 bytes
    const promise = orchestrator.sendTextToAgent(tp, largeText);
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    // paste-start + 3 chunks (1024 + 1024 + 952) + paste-end = 5 calls
    expect(tp.sendInput).toHaveBeenCalledTimes(5);
    expect(tp.sendInput.mock.calls[0][0]).toBe('\x1b[200~');
    expect(tp.sendInput.mock.calls[1][0]).toHaveLength(1024);
    expect(tp.sendInput.mock.calls[2][0]).toHaveLength(1024);
    expect(tp.sendInput.mock.calls[3][0]).toHaveLength(952);
    expect(tp.sendInput.mock.calls[4][0]).toBe('\x1b[201~');
  });
});
