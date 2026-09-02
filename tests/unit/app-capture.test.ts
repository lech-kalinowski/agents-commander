import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureSink } from '../../src/capture/types.js';
import { validateInput } from '../../src/capture/schema.js';

vi.mock('../../src/config/loader.js', async () => {
  const { defaultConfig } = await import('../../src/config/defaults.js');
  return { loadConfig: () => structuredClone(defaultConfig) };
});
vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() },
}));

import { App } from '../../src/app.js';

function sink(overrides: Partial<CaptureSink> = {}): CaptureSink {
  return {
    mode: 'protocol', record: vi.fn(), bindCapability: vi.fn(() => 'cap_1'),
    capabilityRef: vi.fn(() => 'cap_1'), markIncomplete: vi.fn(),
    snapshot: vi.fn(() => ({ mode: 'protocol', state: 'recording', events: 7, bytes: 1000, pendingBytes: 0 })),
    close: vi.fn(async () => undefined), ...overrides,
  };
}

const start = {
  type: 'launched', panelIndex: 4, sessionId: 'local-session', agentType: 'codex',
  agentName: 'Private project label', profileId: 'private-profile', profileLabel: 'Private model label',
};

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('App capture lifecycle ownership', () => {
  it('records allowlisted session fields without names or profile configuration', async () => {
    const capture = sink();
    const app: any = new App('/unused-workspace', { capture });
    app.agentManager.emitLifecycle(start);
    expect(capture.record).toHaveBeenCalledWith({
      type: 'session.start', actor: { sessionId: 'local-session', panel: 5, agentType: 'codex' }, reason: 'launched',
    });
    expect(JSON.stringify(vi.mocked(capture.record).mock.calls)).not.toContain('Private');
    await app.dispose();
  });

  it('keeps the capture subscriber through route drain and shutdown session exits', async () => {
    const order: string[] = [];
    const capture = sink({
      record: vi.fn((event) => { expect(validateInput(event)).toBe(true); order.push(event.type); }),
      close: vi.fn(async () => { order.push('close'); }),
    });
    const app: any = new App('/unused-workspace', { capture });
    app.unsubscribeAgentLifecycle = app.agentManager.onLifecycle(() => { order.push('ui-event'); });
    app.orchestrator = { sealAndDrain: vi.fn(async () => { order.push('drain'); return true; }) };
    vi.spyOn(app.agentManager, 'prepareForShutdown').mockImplementation(() => {
      order.push('shutdown');
      app.agentManager.emitLifecycle({ ...start, type: 'exited', exitCode: 0, signal: null, reason: 'shutdown' });
      return [];
    });
    const disposal = app.dispose();
    expect(app.dispose()).toBe(disposal);
    await disposal;
    expect(order).toEqual(['drain', 'shutdown', 'session.end', 'close']);
    expect(capture.close).toHaveBeenCalledExactlyOnceWith(true);
    app.agentManager.emitLifecycle(start);
    expect(order.at(-1)).toBe('close');
  });

  it('marks timed-out drains incomplete but still restores the screen and closes capture', async () => {
    const capture = sink();
    const app: any = new App('/unused-workspace', { capture });
    app.orchestrator = { sealAndDrain: vi.fn(async () => false) };
    app.screen = { destroy: vi.fn() };
    await app.dispose();
    expect(capture.markIncomplete).toHaveBeenCalledWith('route_drain_timeout');
    expect(capture.close).toHaveBeenCalledOnce();
    expect(app.screen.destroy).toHaveBeenCalledOnce();
  });

  it('isolates capture callback and close failures from the application lifecycle', async () => {
    const capture = sink({
      record: vi.fn(() => { throw new Error('recorder failure'); }),
      markIncomplete: vi.fn(() => { throw new Error('observer failure'); }),
      close: vi.fn(async () => { throw new Error('disk failure'); }),
      snapshot: vi.fn(() => { throw new Error('status failure'); }),
    });
    const app: any = new App('/unused-workspace', { capture });
    expect(() => app.agentManager.emitLifecycle(start)).not.toThrow();
    expect(app.captureStatus()).toEqual({ captureLabel: 'REC:INCOMPLETE' });
    await expect(app.dispose()).resolves.toBeUndefined();
  });

  it('has no capture status or subscriber when recording is disabled', async () => {
    const app: any = new App('/unused-workspace');
    expect(app.captureStatus()).toEqual({});
    expect(app.unsubscribeCaptureLifecycle).toBeNull();
    await app.dispose();
  });

  it('does not render status updates before setup or after disposal starts', async () => {
    vi.useFakeTimers();
    const app: any = new App('/unused-workspace', { capture: sink() });
    app.updateStatus = vi.fn();
    app.refreshCaptureStatus();
    expect(app.updateStatus).not.toHaveBeenCalled();
    app.layout = {}; app.statusBar = {}; app.screen = { destroy: vi.fn() };
    app.refreshCaptureStatus();
    app.refreshCaptureStatus();
    await vi.advanceTimersByTimeAsync(50);
    expect(app.updateStatus).toHaveBeenCalledOnce();
    await app.dispose();
    app.refreshCaptureStatus();
    expect(app.updateStatus).toHaveBeenCalledOnce();
  });
});
