import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureInput, CaptureSink } from '../../src/capture/types.js';
import type { CommanderMessage, MessageType } from '../../src/orchestration/protocol.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import { MessageLedger } from '../../src/orchestration/message-ledger.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() },
}));

function fixture(types = ['codex', 'gemini', 'opencode'], mode: CaptureSink['mode'] = 'protocol') {
  vi.useFakeTimers();
  const events: CaptureInput[] = [];
  const capabilities = new Map<string, string>();
  let nextCapability = 1;
  const sink: CaptureSink = {
    mode,
    record: vi.fn((event) => { events.push(structuredClone(event)); }),
    bindCapability: vi.fn((sessionId) => {
      const ref = `cap_${nextCapability++}`;
      capabilities.set(sessionId, ref);
      return ref;
    }),
    capabilityRef: (sessionId) => capabilities.get(sessionId),
    markIncomplete: vi.fn(),
    snapshot: () => ({ mode, state: mode === 'off' ? 'off' : 'recording', events: events.length, bytes: 0, pendingBytes: 0 }),
    close: vi.fn(async () => {}),
  };
  const panels = types.map((type, panelIndex) => ({
    panelIndex, isRunning: true, cols: 120, sessionGeneration: 1,
    inputGeneration: 0n, inputSynchronized: true,
    sendInput: vi.fn((_text: string) => true),
    updatePanelIndex: vi.fn(), markProtocolTextAsProcessed: vi.fn(),
    reserveProtocolTextForEcho: vi.fn(), snapshotVisibleProtocolAsProcessed: vi.fn(),
    showCommanderActivity: vi.fn(),
    onCommanderMessage: null as ((message: CommanderMessage) => void) | null,
    onUserInput: null as (() => void) | null,
    type, sessionId: `session_${panelIndex}`, profileId: type,
  }));
  const layout = {
    allPanels: panels, panelCount: panels.length,
    hasPanel: (index: number) => Boolean(panels[index]),
    getPanel: (index: number) => panels[index] ?? null,
    getTerminalPanel: (index: number) => panels[index] ?? null,
    convertToTerminal: (index: number) => panels[index] ?? null,
    setActivePanel: vi.fn(),
  };
  const agents = {
    getAgentType: (index: number) => panels[index]?.type ?? null,
    getAgentProfileId: (index: number) => panels[index]?.profileId ?? null,
    getAgentSessionId: (index: number) => panels[index]?.sessionId ?? null,
    getRunningAgents: () => panels.filter((panel) => panel.isRunning).map((panel) => ({
      panelIndex: panel.panelIndex, sessionId: panel.sessionId, type: panel.type,
      name: panel.type, profileId: panel.profileId, status: 'running', uptime: 0,
    })),
    findPanelBySessionId: (sessionId: string) => panels.find((panel) => panel.sessionId === sessionId)?.panelIndex ?? null,
    onLifecycle: vi.fn(),
  };
  const orchestrator = new Orchestrator(layout as never, agents as never, undefined,
    { orchestration: { gridScanDelay: 0, claudeSubmitDelay: 0 } } as never, sink);
  for (const panel of panels) orchestrator.connectPanel(panel as never);
  const internals = orchestrator as any;
  async function arm(index: number, engaged = true) {
    const pending = orchestrator.injectProtocol(panels[index] as never);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(true);
    if (engaged) internals.markSessionEngaged(panels[index].sessionId);
  }
  function emit(type: MessageType, source = 0, content = 'hello', target = 1, capability?: string) {
    const message: CommanderMessage = {
      type, sourcePanel: source, sourceAgent: panels[source].type,
      targetAgent: (type === 'send' ? panels[target]?.type ?? 'codex' : 'generic') as CommanderMessage['targetAgent'],
      targetPanel: type === 'send' ? target : -1, content,
      capability: capability ?? internals.protocolCapabilities.get(panels[source].sessionId),
    };
    panels[source].onCommanderMessage!(message);
  }
  return { orchestrator, internals, panels, sink, events, arm, emit };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Orchestrator semantic capture', () => {
  it('captures only authorized post-startup frames, rejecting bodies without recording them', async () => {
    const f = fixture();
    f.emit('send', 0, 'unarmed body');
    await f.arm(0, false);
    f.emit('send', 0, 'startup body');
    f.emit('send', 0, 'bad key body', 1, 'x'.repeat(43));
    expect(f.events.filter((event) => event.type === 'frame.accepted')).toEqual([]);
    expect(f.events.filter((event) => event.type === 'frame.rejected').map((event) => event.reason))
      .toEqual(['unauthorized', 'startup_suppressed', 'unauthorized']);
    expect(f.events.filter((event) => event.type === 'frame.rejected').every((event) => event.content === undefined)).toBe(true);
  });

  it('records a SEND once before ledger truncation and links actual input, delivery and ACK', async () => {
    const f = fixture();
    await f.arm(0);
    f.events.length = 0;
    f.internals.ledger = new MessageLedger(1000, 8192, 8);
    f.emit('send', 0, 'review the complete payload');
    const accepted = f.events.find((event) => event.type === 'frame.accepted')!;
    expect(accepted).toMatchObject({ verb: 'send', content: 'review the complete payload',
      actor: { sessionId: 'session_0', panel: 1 }, capabilityRef: 'cap_1', targetPanel: 2 });
    expect(f.events.some((event) => event.type === 'input.submitted')).toBe(false);
    await vi.runAllTimersAsync();
    const delivered = f.events.find((event) => event.type === 'route.delivered')!;
    const input = f.events.find((event) => event.type === 'input.submitted')!;
    expect(input).toMatchObject({ inputKind: 'routed', actor: { sessionId: 'session_0' },
      target: { sessionId: 'session_1' }, emissionId: accepted.emissionId, messageId: delivered.messageId });
    expect(input.content).toContain('review the complete payload');
    expect(f.orchestrator.getRecentActivity()[0].content).not.toBe('review the complete payload');
    expect(f.events.find((event) => event.type === 'controller.feedback')).toMatchObject({
      actor: { sessionId: 'session_0' }, outcome: 'submitted', emissionId: accepted.emissionId,
    });
    expect(f.events.findIndex((event) => event.type === 'input.submitted'))
      .toBeLessThan(f.events.findIndex((event) => event.type === 'route.delivered'));
  });

  it('uses one broadcast emission for fan-out and does not invent per-target feedback', async () => {
    const f = fixture();
    await f.arm(0);
    f.events.length = 0;
    f.emit('broadcast', 0, 'review independently');
    await vi.runAllTimersAsync();
    const frames = f.events.filter((event) => event.type === 'frame.accepted');
    const routes = f.events.filter((event) => event.type === 'route.delivered');
    expect(frames).toHaveLength(1);
    expect(routes).toHaveLength(2);
    expect(new Set(routes.map((event) => event.emissionId))).toEqual(new Set([frames[0].emissionId]));
    expect(new Set(routes.map((event) => event.messageId)).size).toBe(2);
    expect(f.events.filter((event) => event.type === 'controller.feedback')).toHaveLength(1);
    expect(f.events.find((event) => event.type === 'controller.feedback')?.content).toContain('kind=broadcast queued=2');
  });

  it('captures the resolved REPLY window and a no-window failure without guessing a target', async () => {
    const f = fixture();
    await f.arm(0); await f.arm(1);
    f.emit('send', 0, 'please review');
    await vi.runAllTimersAsync();
    const sent = f.events.find((event) => event.type === 'route.delivered')!;
    f.emit('reply', 1, 'review finished');
    await vi.runAllTimersAsync();
    const reply = f.events.find((event) => event.type === 'frame.accepted' && event.verb === 'reply')!;
    expect(reply).toMatchObject({ target: { sessionId: 'session_0', panel: 1 },
      threadId: sent.threadId, replyToMessageId: sent.messageId });
    f.emit('reply', 1, 'duplicate reply without another open window');
    expect(f.events.at(-1)).toMatchObject({ type: 'route.failed', reason: 'no_reply_window' });
  });

  it('captures actual STATUS and QUERY feedback without pretending they are routed deliveries', async () => {
    const f = fixture();
    await f.arm(0);
    f.events.length = 0;
    f.emit('status', 0, 'working');
    f.emit('query', 0, 'ping');
    await vi.runAllTimersAsync();
    expect(f.events.filter((event) => event.type === 'frame.accepted').map((event) => event.verb))
      .toEqual(['status', 'query']);
    expect(f.events.filter((event) => event.type === 'controller.feedback').map((event) => event.content))
      .toEqual(['[Commander ACK] kind=status status=accepted text="working"', '[Commander] PONG']);
    expect(f.events.some((event) => event.type === 'route.delivered')).toBe(false);
  });

  it('retains the claimed REPLY references across failed delivery and a restored-window retry', async () => {
    const f = fixture();
    await f.arm(0); await f.arm(1);
    f.emit('send', 0, 'please review');
    await vi.runAllTimersAsync();
    f.panels[0].sendInput.mockReturnValue(false);
    f.emit('reply', 1, 'first reply');
    await vi.runAllTimersAsync();
    f.panels[0].sendInput.mockReturnValue(true);
    f.emit('reply', 1, 'retry reply');
    await vi.runAllTimersAsync();
    const replies = f.events.filter((event) => event.type === 'frame.accepted' && event.verb === 'reply');
    expect(replies).toHaveLength(2);
    expect(replies[1].replyToMessageId).toBe(replies[0].replyToMessageId);
    expect(replies[1].threadId).toBe(replies[0].threadId);
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'route.failed', emissionId: replies[0].emissionId }));
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'route.delivered', emissionId: replies[1].emissionId }));
  });

  it('captures protocol rotation and explicit task/template content at submission', async () => {
    const f = fixture();
    await f.arm(0);
    const protocol = f.events.find((event) => event.type === 'input.submitted' && event.inputKind === 'protocol')!;
    expect(protocol).toMatchObject({ capabilityRef: 'cap_1', outcome: 'submitted' });
    expect(protocol.content).toContain('COMMANDER');
    const pending = f.orchestrator.sendTask('codex', 0, 'review this code');
    await vi.runAllTimersAsync(); await pending;
    const template = f.orchestrator.sendTemplateTask('codex', 0, { content: 'explain this module', bindProtocolCapability: false });
    await vi.runAllTimersAsync(); await template;
    await f.arm(0);
    expect(f.events.filter((event) => event.type === 'protocol.armed').map((event) => event.capabilityRef))
      .toEqual(['cap_1', 'cap_2']);
    expect(f.events.filter((event) => event.type === 'input.submitted').map((event) => event.inputKind))
      .toEqual(['protocol', 'task', 'template', 'protocol']);
  });

  it('stores manual input as one metadata-only coverage warning, never keystrokes', () => {
    const f = fixture();
    f.panels[0].onUserInput!(); f.panels[0].onUserInput!();
    expect(f.events).toEqual([{ type: 'input.unknown', actor: { sessionId: 'session_0', panel: 1, agentType: 'codex' },
      reason: 'manual_input', coverage: 'missing-manual-input' }]);
  });

  it('labels internal demo arming and START without inventing observed protocol instructions', async () => {
    const f = fixture();
    f.panels[0].profileId = 'internal';
    expect(f.orchestrator.armInternalProtocol(f.panels[0] as never, 'D'.repeat(43))).toBe(true);
    expect(await f.orchestrator.sendProgrammaticInput(f.panels[0] as never, 'START', true)).toBe(true);
    expect(f.events.map((event) => [event.type, event.inputKind])).toEqual([
      ['protocol.armed', 'demo'], ['input.submitted', 'demo'],
    ]);
    expect(f.events[0].content).toBeUndefined();
    expect(f.events[1].content).toBe('START');
  });

  it('captures Claude feedback after flattening/truncation and marks context incomplete', async () => {
    const f = fixture(['claude', 'codex']);
    await f.arm(0);
    f.panels[0].cols = 32;
    f.emit('query', 0, 'agents');
    await vi.runAllTimersAsync();
    const feedback = f.events.find((event) => event.type === 'controller.feedback')!;
    expect(feedback.content).not.toContain('\n');
    expect(feedback.content).toHaveLength(30);
    expect(feedback.coverage).toBe('truncated');
    expect(f.panels[0].sendInput).toHaveBeenCalledWith(`${feedback.content}\r`);
    expect(f.events.at(-1)).toMatchObject({ type: 'input.unknown', reason: 'feedback_truncated' });
  });

  it('never records queued intent as submitted input after a partial write failure', async () => {
    const f = fixture();
    await f.arm(0);
    f.panels[1].sendInput.mockImplementation((text) => text !== '\r');
    f.events.length = 0;
    f.emit('send');
    await vi.runAllTimersAsync();
    expect(f.events.some((event) => event.type === 'input.submitted')).toBe(false);
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'input.unknown', reason: 'partial_programmatic_input' }));
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'route.failed', reason: 'delivery_failed' }));
  });

  it('keeps capture disabled and survives throwing recorder hooks without changing delivery', async () => {
    const off = fixture(['codex', 'gemini'], 'off');
    await off.arm(0); off.emit('send'); await vi.runAllTimersAsync();
    expect(off.sink.record).not.toHaveBeenCalled();
    expect(off.sink.bindCapability).not.toHaveBeenCalled();
    expect(off.orchestrator.getRecentActivity()[0].status).toBe('delivered');
    const f = fixture();
    vi.mocked(f.sink.record).mockImplementation(() => { throw new Error('recorder broke'); });
    vi.mocked(f.sink.bindCapability).mockImplementation(() => { throw new Error('recorder broke'); });
    await f.arm(0); f.emit('send'); await vi.runAllTimersAsync();
    expect(f.orchestrator.getRecentActivity()[0].status).toBe('delivered');
    expect(f.sink.markIncomplete).toHaveBeenCalledWith('capture_hook_failed');
  });

  it('seals admission, cancels queued tasks, and waits for active delivery settlement', async () => {
    const f = fixture();
    await f.arm(0);
    f.emit('send', 0, 'active'); f.emit('send', 0, 'queued');
    const drain = f.orchestrator.sealAndDrain(1000);
    expect(await f.orchestrator.sendTask('codex', 0, 'not allowed after seal')).toMatchObject({ success: false });
    expect(await f.orchestrator.sendProgrammaticInput(f.panels[0] as never, 'no', true)).toBe(false);
    await vi.runAllTimersAsync();
    expect(await drain).toBe(true);
    expect(f.events.filter((event) => event.type === 'route.failed' && event.reason === 'shutdown').length).toBeGreaterThanOrEqual(2);
    expect(f.sink.close).not.toHaveBeenCalled();
    expect(f.internals.drainWork.size).toBe(0);
  });

  it('bounds drain time and marks capture incomplete if an input lane cannot settle', async () => {
    const f = fixture();
    f.internals.inputLaneTails.set('session_0', new Promise(() => {}));
    const pending = f.orchestrator.sendProgrammaticInput(f.panels[0] as never, 'queued control', true);
    void pending;
    const drain = f.orchestrator.sealAndDrain(10);
    await vi.advanceTimersByTimeAsync(10);
    expect(await drain).toBe(false);
    expect(f.sink.markIncomplete).toHaveBeenCalledWith('route_drain_timeout');
    expect(f.panels[0].sendInput).not.toHaveBeenCalled();
  });
});
