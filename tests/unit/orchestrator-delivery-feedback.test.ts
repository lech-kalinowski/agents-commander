import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import type { MessageType, ProtocolEvent } from '../../src/orchestration/protocol.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const capability = 'a'.repeat(43); // Synthetic public fixture, never an API key.
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture(count = 2) {
  const sessions = new Map<number, string>();
  const panels = new Map<number, any>();
  for (let index = 0; index < count; index++) {
    sessions.set(index, `session-${index}`);
    panels.set(index, {
      panelIndex: index, isRunning: true, sessionGeneration: 1,
      sendInput: vi.fn(() => true), updatePanelIndex: vi.fn(),
      onCommanderMessage: null, onCommanderProtocolError: null, onUserInput: null,
    });
  }
  const agents: any = {
    getAgentSessionId: (index: number) => sessions.get(index) ?? null,
    getAgentType: (index: number) => sessions.has(index) ? 'opencode' : null,
    getAgentProfileId: (index: number) => sessions.has(index) ? 'apex' : null,
    getRunningAgents: () => [...sessions.entries()].map(([panelIndex, sessionId]) => ({
      panelIndex, sessionId, type: 'opencode', profileId: 'apex', name: `APEX ${panelIndex + 1}`,
      status: 'running', uptime: 1,
    })),
    findPanelBySessionId: (id: string) => [...sessions].find(([, value]) => value === id)?.[0] ?? null,
    onLifecycle: () => () => {},
  };
  const layout: any = {
    get allPanels() { return [...panels.values()]; },
    get panelCount() { return panels.size; },
    hasPanel: (index: number) => panels.has(index),
    getPanel: (index: number) => panels.get(index) ?? null,
    getTerminalPanel: (index: number) => panels.get(index) ?? null,
    convertToTerminal: (index: number) => panels.get(index) ?? null,
    setActivePanel: vi.fn(),
  };
  const orchestrator = new Orchestrator(layout, agents) as any;
  for (const panel of panels.values()) {
    orchestrator.connectPanel(panel);
    orchestrator.protocolInjected.add(panel.panelIndex);
    orchestrator.protocolCapabilities.set(sessions.get(panel.panelIndex), capability);
  }
  const emit = (kind: MessageType, source = 0, target = 1, key = capability) => {
    panels.get(source).onCommanderMessage({
      type: kind, sourcePanel: source, sourceAgent: `APEX ${source + 1}`,
      targetAgent: 'opencode', targetPanel: target, content: 'synthetic task',
      capability: key, sequence: 1,
    } satisfies ProtocolEvent);
  };
  const hold = (index: number) => {
    const queue = { tasks: [], processing: true, currentTask: null, detachedReason: null };
    orchestrator.panelQueues.set(index, queue);
    return queue;
  };
  const replyWindow = (waiting = 0, returnTo = 1) => {
    orchestrator.ledger.openReplyWindow({
      threadId: 'thread-original', replyToMessageId: 'message-original',
      waitingOnSessionId: sessions.get(waiting), returnToSessionId: sessions.get(returnTo),
      returnToAgentName: `APEX ${returnTo + 1}`, returnToAgentType: 'opencode',
    });
  };
  const inputs = (index = 0): string[] => panels.get(index).sendInput.mock.calls.map(([text]: [string]) => text);
  return { orchestrator, sessions, panels, agents, layout, emit, hold, replyWindow, inputs };
}

describe('Orchestrator explicit delivery failure feedback', () => {
  it('NACKs an authenticated REPLY with no window without guessing a target', () => {
    const f = fixture();
    f.emit('reply');
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('kind=reply status=failed');
    expect(f.inputs()[0]).toContain('No open reply window');
    expect(f.inputs(1)).toEqual([]);
    expect(f.orchestrator.getRecentActivity()).toEqual([]);
  });

  it('does not send rejection feedback for a wrong capability', () => {
    const f = fixture();
    f.emit('reply', 0, 1, 'b'.repeat(43));
    expect(f.inputs()).toEqual([]);
  });

  it('NACKs a REPLY to a vanished return session without redirecting it', () => {
    const f = fixture();
    f.replyWindow();
    f.sessions.set(1, 'replacement-session');
    f.emit('reply');
    expect(f.inputs()[0]).toContain('recipient session is no longer available');
    expect(f.inputs(1)).toEqual([]);
    expect(f.orchestrator.getRecentActivity()).toEqual([]);
  });

  it('NACKs a singleton BROADCAST with zero queued recipients', () => {
    const f = fixture(1);
    f.emit('broadcast');
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('kind=broadcast status=failed');
    expect(f.inputs()[0]).toContain('Nothing was queued');
  });

  it('NACKs a BROADCAST when remaining connected panels no longer have agents', () => {
    const f = fixture();
    f.sessions.delete(1);
    f.emit('broadcast');
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('No other connected agents');
  });

  it('does not deliver delayed command failure feedback into a replacement source session', async () => {
    const f = fixture();
    let release!: () => void;
    f.orchestrator.inputLaneTails.set('session-0', new Promise<void>((resolve) => { release = resolve; }));
    f.emit('reply');
    expect(f.inputs()).toEqual([]);
    f.sessions.set(0, 'replacement-source');
    release();
    await settle();
    expect(f.inputs()).toEqual([]);
  });

  it.each(['send', 'reply'] as const)('NACKs queued %s once when its recipient panel closes', (kind) => {
    const f = fixture();
    const queue = f.hold(1);
    if (kind === 'reply') f.replyWindow();
    f.emit(kind);
    expect(queue.tasks).toHaveLength(1);
    f.orchestrator.disconnectPanel(1);
    f.orchestrator.disconnectPanel(1);
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('status=failed');
    expect(f.inputs()[0]).toContain('panel=2');
    expect(f.inputs()[0]).toContain('Panel 2 is no longer available');
    expect(f.orchestrator.getRecentActivity()[0].status).toBe('dropped');
    expect(f.orchestrator.ledger.getPendingReplyCount()).toBe(0);
  });

  it.each(['shutdown', 'source-replaced', 'source-closed', 'self-close'])('keeps cancelled routes quiet during %s', async (mode) => {
    const f = fixture();
    const target = mode === 'self-close' ? 0 : 1;
    f.hold(target);
    f.emit('send', 0, target);
    if (mode === 'shutdown') await f.orchestrator.sealAndDrain(0);
    else {
      if (mode === 'source-replaced') f.sessions.set(0, 'new-source');
      if (mode === 'source-closed') f.orchestrator.disconnectPanel(0);
      f.orchestrator.disconnectPanel(target);
    }
    expect(f.inputs()).toEqual([]);
  });

  it('reports one later broadcast recipient failure without claiming all six-panel work finished', async () => {
    const f = fixture(6);
    const results = new Map<number, (result: { success: boolean; error?: string }) => void>();
    f.orchestrator.executeTask = vi.fn((_type: string, panel: number) => new Promise((resolve) => { results.set(panel, resolve); }));
    f.emit('broadcast');
    expect(results.size).toBe(5);
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('kind=broadcast queued=5');
    results.get(2)!({ success: false, error: 'Receiver stopped accepting input' });
    await settle();
    expect(f.inputs()).toHaveLength(2);
    expect(f.inputs()[1]).toContain('kind=broadcast status=failed scope=recipient stage=delivery');
    expect(f.inputs()[1]).toContain('panel=3');
    expect(f.inputs()[1]).toContain('not completion of the broadcast');
    expect(f.orchestrator.getRecentActivity().filter((record: any) => record.status === 'queued')).toHaveLength(4);
    for (const [panel, resolve] of results) if (panel !== 2) resolve({ success: true });
    await settle();
    expect(f.inputs()).toHaveLength(2);
    expect(f.orchestrator.getRecentActivity().filter((record: any) => record.status === 'delivered')).toHaveLength(4);
  });

  it('reports an admitted broadcast recipient cancelled while still queued exactly once', async () => {
    const f = fixture(6);
    for (let panel = 1; panel < 6; panel++) f.hold(panel);
    f.emit('broadcast');
    f.orchestrator.disconnectPanel(2);
    f.orchestrator.disconnectPanel(2);
    await settle();
    expect(f.inputs()).toHaveLength(2);
    expect(f.inputs()[0]).toContain('queued=5');
    expect(f.inputs()[1]).toContain('scope=recipient stage=delivery');
    expect(f.inputs()[1]).toContain('panel=3');
  });

  it('does not duplicate the combined admission rejection with a recipient delivery failure', async () => {
    const f = fixture(6);
    f.orchestrator.getQueueAdmissionError = (panel: number) => panel === 2 ? 'Synthetic capacity limit' : null;
    f.orchestrator.executeTask = vi.fn(async () => ({ success: true }));
    f.emit('broadcast');
    await settle();
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('kind=broadcast status=partial');
    expect(f.inputs()[0]).toContain('queued=4 rejected=1');
    expect(f.inputs()[0]).not.toContain('stage=delivery');
  });

  it('does not send later broadcast failures into a replaced source session', async () => {
    const f = fixture();
    let finish!: (result: { success: boolean; error: string }) => void;
    f.orchestrator.executeTask = () => new Promise((resolve) => { finish = resolve; });
    f.emit('broadcast');
    f.sessions.set(0, 'replacement-source');
    finish({ success: false, error: 'Receiver failed' });
    await settle();
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('queued=1');
  });

  it.each(['invalid-frame', 'oversized-frame'] as const)('reports %s without payload or capability disclosure', (reason) => {
    const f = fixture();
    f.panels.get(0).onCommanderProtocolError(reason);
    expect(f.inputs()).toHaveLength(1);
    expect(f.inputs()[0]).toContain('[Commander protocol error] Message was not sent');
    expect(f.inputs()[0]).toContain('fresh counter');
    expect(f.inputs()[0]).not.toContain(capability);
    expect(f.inputs(1)).toEqual([]);
  });

  it.each(['unarmed', 'new-generation', 'new-session', 'panel-replaced', 'shutdown'])('ignores protocol errors for %s targets', (mode) => {
    const f = fixture();
    const panel = f.panels.get(0);
    const callback = panel.onCommanderProtocolError;
    if (mode === 'unarmed') f.orchestrator.protocolInjected.delete(0);
    if (mode === 'new-generation') panel.sessionGeneration++;
    if (mode === 'new-session') f.sessions.set(0, 'new-session');
    if (mode === 'panel-replaced') f.panels.set(0, { ...panel });
    if (mode === 'shutdown') f.orchestrator.sealed = true;
    callback('invalid-frame');
    expect(f.inputs()).toEqual([]);
  });

  it('clears protocol error callbacks during disconnect and reset', () => {
    const f = fixture();
    f.orchestrator.disconnectPanel(0);
    expect(f.panels.get(0).onCommanderProtocolError).toBeNull();
    f.orchestrator.resetState();
    expect(f.panels.get(1).onCommanderProtocolError).toBeNull();
  });

  it.each([false, true])('rejects unavailable protocol transport without writing or changing an existing key (armed=%s)', async (armed) => {
    const f = fixture();
    const panel = f.panels.get(0);
    panel.getProtocolSetupError = vi.fn(() => 'OpenCode communication is unavailable. Restart this agent.');
    panel.setProtocolCapability = vi.fn();
    if (!armed) {
      f.orchestrator.protocolInjected.delete(0);
      f.orchestrator.protocolCapabilities.delete('session-0');
    }
    await expect(f.orchestrator.injectProtocol(panel)).resolves.toBe(false);
    expect(f.inputs()).toEqual([]);
    expect(panel.setProtocolCapability).not.toHaveBeenCalled();
    expect(f.orchestrator.protocolCapabilities.get('session-0')).toBe(armed ? capability : undefined);
    expect(f.orchestrator.protocolInjected.has(0)).toBe(armed);
  });

  it('rechecks protocol transport readiness when a queued injection reaches its input lane', async () => {
    const f = fixture();
    const panel = f.panels.get(0);
    let setupError: string | null = null;
    panel.getProtocolSetupError = () => setupError;
    panel.setProtocolCapability = vi.fn();
    let release!: () => void;
    f.orchestrator.inputLaneTails.set('session-0', new Promise<void>((resolve) => { release = resolve; }));
    const injection = f.orchestrator.injectProtocol(panel);
    setupError = 'OpenCode communication is unavailable. Restart this agent.';
    release();
    await expect(injection).resolves.toBe(false);
    expect(f.inputs()).toEqual([]);
    expect(panel.setProtocolCapability).not.toHaveBeenCalled();
    expect(f.orchestrator.protocolCapabilities.get('session-0')).toBe(capability);
  });
});
