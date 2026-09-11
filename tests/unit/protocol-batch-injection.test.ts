import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentType } from '../../src/agents/types.js';
import type { CaptureSink } from '../../src/capture/types.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

interface AgentSpec {
  id: number;
  type?: AgentType;
  profile?: string;
  running?: boolean;
  status?: string;
}

function terminal(panelIndex: number, running = true) {
  return {
    panelIndex, isRunning: running, sessionGeneration: 1,
    sendInput: vi.fn((_text: string) => true),
    updatePanelIndex: vi.fn(), markProtocolTextAsProcessed: vi.fn(),
    snapshotVisibleProtocolAsProcessed: vi.fn(),
  };
}

function fixture(specs: AgentSpec[] = [{ id: 0 }, { id: 16 }]) {
  const panels = new Map(specs.map(spec => [spec.id, terminal(spec.id, spec.running ?? true)]));
  const records = new Map(specs.map(spec => [spec.id, {
    panelIndex: spec.id, sessionId: `session-${spec.id}`,
    type: spec.type ?? 'codex', profileId: spec.profile ?? spec.type ?? 'codex',
    profileLabel: `Profile ${spec.id}`, name: `Agent ${spec.id}`,
    status: spec.status ?? 'running', uptime: 0,
  }]));
  const layout = {
    get workspacePanelIds() { return [...panels.keys()]; },
    get allPanels() { return [...panels.values()]; },
    // Deliberately show only the first panel: selection must include hidden sessions.
    get visiblePanelIds() { return [...panels.keys()].slice(0, 1); },
    hasPanel: (id: number) => panels.has(id),
    getPanel: (id: number) => panels.get(id) ?? null,
    getTerminalPanel: (id: number) => panels.get(id) ?? null,
    addPanel: vi.fn(), convertToTerminal: vi.fn(), setActivePanel: vi.fn(),
  };
  const liveRecord = (id: number) => panels.get(id)?.isRunning ? records.get(id) : undefined;
  const manager = {
    getAgentType: (id: number) => liveRecord(id)?.type ?? null,
    getAgentProfileId: (id: number) => liveRecord(id)?.profileId ?? null,
    getAgentSessionId: (id: number) => liveRecord(id)?.sessionId ?? null,
    getRunningAgents: () => [...records.values()].filter(record =>
      panels.get(record.panelIndex)?.isRunning || record.status === 'restarting'),
    onLifecycle: vi.fn(() => () => {}),
    launchAgent: vi.fn(), launchProfile: vi.fn(), killAgent: vi.fn(),
  };
  const capture: CaptureSink = {
    mode: 'off', record: vi.fn(), bindCapability: vi.fn(), capabilityRef: vi.fn(),
    markIncomplete: vi.fn(), close: vi.fn(async () => {}),
    snapshot: () => ({ mode: 'off', state: 'off', events: 0, bytes: 0, pendingBytes: 0 }),
  };
  const orchestrator = new Orchestrator(layout as never, manager as never, undefined, undefined, capture);
  const internals = orchestrator as any;
  vi.spyOn(internals, 'delay').mockResolvedValue(undefined);
  const capability = (id: number): string | undefined => internals.protocolCapabilities.get(records.get(id)?.sessionId);
  return { panels, records, layout, manager, orchestrator, internals, capture, capability };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function queuedLane(f: ReturnType<typeof fixture>, target: object) {
  const gate = deferred();
  const pending = f.internals.withSessionInputLane(target, () => gate.promise) as Promise<void>;
  return { release: gate.resolve, pending };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('explicit exact-session protocol injection', () => {
  it('submits to 16 selected sessions with independent keys and no launch, task, or recording enablement', async () => {
    const f = fixture(Array.from({ length: 16 }, (_, index) => ({ id: index * 3 })));
    const targets = f.orchestrator.getProtocolInjectionTargets();
    expect(targets).toHaveLength(16);
    const keys: string[] = [];
    for (const target of targets) {
      expect(await f.orchestrator.injectProtocolTarget(target, { skipIfArmed: true })).toBe('submitted');
      const key = f.capability(target.panelIndex)!;
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      keys.push(key);
      const panel = f.panels.get(target.panelIndex)!;
      const inputs = panel.sendInput.mock.calls.map(([value]) => value);
      expect(inputs[0]).toBe('\x1b[200~');
      expect(inputs.at(-2)).toBe('\x1b[201~');
      expect(inputs.at(-1)).toBe('\r');
      expect(inputs.join('')).toContain(`Protocol capability: ${key}.`);
      expect(panel.markProtocolTextAsProcessed).toHaveBeenCalledOnce();
      expect(panel.snapshotVisibleProtocolAsProcessed).toHaveBeenCalledOnce();
    }
    expect(new Set(keys).size).toBe(16);
    expect(f.orchestrator.getRecentActivity()).toEqual([]);
    expect(f.layout.addPanel).not.toHaveBeenCalled();
    expect(f.layout.convertToTerminal).not.toHaveBeenCalled();
    expect(f.layout.setActivePanel).not.toHaveBeenCalled();
    expect(f.manager.launchAgent).not.toHaveBeenCalled();
    expect(f.manager.launchProfile).not.toHaveBeenCalled();
    expect(f.manager.killAgent).not.toHaveBeenCalled();
    expect(f.capture.mode).toBe('off');
    expect(f.capture.bindCapability).not.toHaveBeenCalled();
    expect(f.capture.close).not.toHaveBeenCalled();
  });

  it('preserves hidden stable IDs and touches only the chosen subset', async () => {
    const f = fixture([91, 3, 70, 0].map(id => ({ id })));
    const targets = f.orchestrator.getProtocolInjectionTargets();
    expect(new Set(targets.map(target => target.panelIndex))).toEqual(new Set([91, 3, 70, 0]));
    for (const target of targets.filter(target => [70, 0].includes(target.panelIndex))) {
      expect(await f.orchestrator.injectProtocolTarget(target, { skipIfArmed: true })).toBe('submitted');
    }
    expect(f.panels.get(91)!.sendInput).not.toHaveBeenCalled();
    expect(f.panels.get(3)!.sendInput).not.toHaveBeenCalled();
    expect(f.panels.get(70)!.sendInput).toHaveBeenCalled();
    expect(f.panels.get(0)!.sendInput).toHaveBeenCalled();
  });

  it('excludes exited, restarting, internal, unmanaged, and built-in Shell sessions while allowing custom generic profiles', () => {
    const f = fixture([
      { id: 0 }, { id: 1, running: false }, { id: 2, running: false, status: 'restarting' },
      { id: 3, type: 'generic', profile: 'internal' },
      { id: 4, type: 'generic', profile: 'generic' },
      { id: 5, type: 'generic', profile: 'apex-custom' },
    ]);
    f.panels.set(6, terminal(6));
    expect(f.orchestrator.getProtocolInjectionTargets().map(target => target.panelIndex)).toEqual([0, 5]);
    const empty = fixture([]);
    expect(empty.orchestrator.getProtocolInjectionTargets()).toEqual([]);
  });

  it.each(['removed-panel', 'replaced-panel', 'session', 'profile', 'type', 'exit'])(
    'rejects a target changed after selection: %s', async change => {
      const f = fixture();
      const target = f.orchestrator.getProtocolInjectionTargets()[0];
      const original = f.panels.get(target.panelIndex)!;
      const record = f.records.get(target.panelIndex)!;
      if (change === 'removed-panel') f.panels.delete(target.panelIndex);
      if (change === 'replaced-panel') f.panels.set(target.panelIndex, terminal(target.panelIndex));
      if (change === 'session') record.sessionId += '-replacement';
      if (change === 'profile') record.profileId = 'another-codex-profile';
      if (change === 'type') record.type = 'claude';
      if (change === 'exit') original.isRunning = false;
      expect(await f.orchestrator.injectProtocolTarget(target, { skipIfArmed: true })).toBe('stale');
      expect(original.sendInput).not.toHaveBeenCalled();
      expect(f.panels.get(target.panelIndex)?.sendInput.mock.calls ?? []).toHaveLength(0);
      expect(f.orchestrator.isProtocolArmed(target)).toBe(false);
    },
  );

  it('rechecks exact identity after waiting for the session input lane', async () => {
    const f = fixture();
    const target = f.orchestrator.getProtocolInjectionTargets()[0];
    const lane = queuedLane(f, target);
    const result = f.orchestrator.injectProtocolTarget(target, { skipIfArmed: true });
    f.records.get(target.panelIndex)!.sessionId += '-replacement';
    lane.release();
    await lane.pending;
    expect(await result).toBe('stale');
    expect(f.panels.get(target.panelIndex)!.sendInput).not.toHaveBeenCalled();
    expect(f.internals.protocolCapabilities.size).toBe(0);
  });

  it('skips a session armed by an earlier queued Ctrl+P without rotating its new key', async () => {
    const f = fixture();
    const target = f.orchestrator.getProtocolInjectionTargets()[0];
    const lane = queuedLane(f, target);
    const single = f.orchestrator.injectProtocol(target.terminal);
    const bulk = f.orchestrator.injectProtocolTarget(target, { skipIfArmed: true });
    lane.release();
    await lane.pending;
    expect(await single).toBe(true);
    const key = f.capability(target.panelIndex);
    expect(await bulk).toBe('already-armed');
    expect(f.capability(target.panelIndex)).toBe(key);
    expect(f.panels.get(target.panelIndex)!.markProtocolTextAsProcessed).toHaveBeenCalledOnce();
    expect(f.orchestrator.isProtocolArmed(target)).toBe(true);
    expect(f.orchestrator.getProtocolInjectionTargets()[0].armed).toBe(true);
  });

  it('ignores a stale armed flag and skips already-armed sessions at execution time', async () => {
    const f = fixture();
    const target = f.orchestrator.getProtocolInjectionTargets()[0];
    expect(target.armed).toBe(false);
    expect(await f.orchestrator.injectProtocolTarget(target)).toBe('submitted');
    const key = f.capability(target.panelIndex);
    const writes = f.panels.get(target.panelIndex)!.sendInput.mock.calls.length;
    expect(await f.orchestrator.injectProtocolTarget(target, { skipIfArmed: true })).toBe('already-armed');
    expect(f.capability(target.panelIndex)).toBe(key);
    expect(f.panels.get(target.panelIndex)!.sendInput).toHaveBeenCalledTimes(writes);
  });

  it('cancels before scheduling without writing or arming', async () => {
    const f = fixture();
    const target = f.orchestrator.getProtocolInjectionTargets()[0];
    expect(await f.orchestrator.injectProtocolTarget(target, { shouldCancel: () => true })).toBe('cancelled');
    expect(f.panels.get(target.panelIndex)!.sendInput).not.toHaveBeenCalled();
    expect(f.orchestrator.isProtocolArmed(target)).toBe(false);
  });

  it('cancels while queued without writing or arming', async () => {
    const f = fixture();
    const target = f.orchestrator.getProtocolInjectionTargets()[0];
    const lane = queuedLane(f, target);
    let cancelled = false;
    const result = f.orchestrator.injectProtocolTarget(target, { shouldCancel: () => cancelled });
    cancelled = true;
    lane.release();
    await lane.pending;
    expect(await result).toBe('cancelled');
    expect(f.panels.get(target.panelIndex)!.sendInput).not.toHaveBeenCalled();
    expect(f.orchestrator.isProtocolArmed(target)).toBe(false);
  });

  it('finishes an already-started paste and submit, then cancels the next target', async () => {
    const f = fixture();
    const [first, second] = f.orchestrator.getProtocolInjectionTargets();
    const panel = f.panels.get(first.panelIndex)!;
    let cancelled = false;
    panel.sendInput.mockImplementation(text => {
      if (text === '\x1b[200~') cancelled = true;
      return true;
    });
    expect(await f.orchestrator.injectProtocolTarget(first, { shouldCancel: () => cancelled })).toBe('submitted');
    expect(panel.sendInput).toHaveBeenLastCalledWith('\r');
    expect(f.orchestrator.isProtocolArmed(first)).toBe(true);
    expect(await f.orchestrator.injectProtocolTarget(second, { shouldCancel: () => cancelled })).toBe('cancelled');
    expect(f.panels.get(second.panelIndex)!.sendInput).not.toHaveBeenCalled();
    expect(f.orchestrator.isProtocolArmed(second)).toBe(false);
  });

  it.each(['paste', 'submit', 'throw'])('disarms after %s failure and leaves other sessions untouched', async phase => {
    const f = fixture();
    const [first, second] = f.orchestrator.getProtocolInjectionTargets();
    const panel = f.panels.get(first.panelIndex)!;
    panel.sendInput.mockImplementation(text => {
      if (phase === 'throw') throw new Error('synthetic write failure');
      return phase === 'paste' ? false : text !== '\r';
    });
    expect(await f.orchestrator.injectProtocolTarget(first)).toBe('failed');
    expect(f.orchestrator.isProtocolArmed(first)).toBe(false);
    expect(f.capability(first.panelIndex)).toBeUndefined();
    expect(panel.snapshotVisibleProtocolAsProcessed).not.toHaveBeenCalled();
    expect(f.panels.get(second.panelIndex)!.sendInput).not.toHaveBeenCalled();
    expect(await f.orchestrator.injectProtocolTarget(second)).toBe('submitted');
  });

  it('does not submit to a replacement session if identity changes mid-paste', async () => {
    const f = fixture();
    const target = f.orchestrator.getProtocolInjectionTargets()[0];
    const panel = f.panels.get(target.panelIndex)!;
    panel.sendInput.mockImplementation(text => {
      if (text !== '\x1b[200~') f.records.get(target.panelIndex)!.sessionId += '-replacement';
      return true;
    });
    expect(await f.orchestrator.injectProtocolTarget(target)).toBe('stale');
    expect(panel.sendInput).not.toHaveBeenCalledWith('\r');
    expect(f.internals.protocolCapabilities.size).toBe(0);
    expect(f.orchestrator.isProtocolArmed(target)).toBe(false);
  });

  it('rejects pending and future injection when shutdown seals the input lanes', async () => {
    const f = fixture();
    const [first, second] = f.orchestrator.getProtocolInjectionTargets();
    const lane = queuedLane(f, first);
    const queued = f.orchestrator.injectProtocolTarget(first);
    expect(await f.orchestrator.sealAndDrain(0)).toBe(false);
    lane.release();
    await lane.pending;
    expect(await queued).toBe('cancelled');
    expect(await f.orchestrator.injectProtocolTarget(second)).toBe('cancelled');
    expect(await f.orchestrator.sealAndDrain(0)).toBe(true);
    for (const panel of f.panels.values()) expect(panel.sendInput).not.toHaveBeenCalled();
    expect(f.internals.protocolCapabilities.size).toBe(0);
  });

  it('preserves the active-only Ctrl+P wrapper and explicit key rotation', async () => {
    const f = fixture();
    const [first, second] = f.orchestrator.getProtocolInjectionTargets();
    expect(await f.orchestrator.injectProtocol(first.terminal)).toBe(true);
    const firstKey = f.capability(first.panelIndex);
    expect(await f.orchestrator.injectProtocol(first.terminal)).toBe(true);
    expect(f.capability(first.panelIndex)).not.toBe(firstKey);
    expect(f.orchestrator.isProtocolArmed(first)).toBe(true);
    expect(f.orchestrator.isProtocolArmed(second)).toBe(false);
    expect(f.panels.get(second.panelIndex)!.sendInput).not.toHaveBeenCalled();
  });
});
