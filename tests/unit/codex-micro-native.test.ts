import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  },
}));

import { CodexMicroNativeBridge } from '../../src/hardware/codex-micro-native.js';

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    child.signalCode = signal;
    child.emit('close', null, signal);
    return true;
  });
  return child;
}

function send(child: FakeChild, message: unknown): void {
  const record = message && typeof message === 'object'
    ? { version: 1, ...message }
    : message;
  child.stdout.write(`${JSON.stringify(record)}\n`);
}

const activeBridges: CodexMicroNativeBridge[] = [];

function createHarness(options: {
  now?: () => number;
  epochs?: string[];
} = {}) {
  const children: FakeChild[] = [];
  const spawnProcess = vi.fn(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  const epochs = [...(options.epochs ?? ['epoch-1', 'epoch-2', 'epoch-3'])];
  const bridge = new CodexMicroNativeBridge({
    platform: 'darwin',
    pythonPath: '/usr/bin/python3',
    helperPath: '/package/dist/hardware/codex-micro-bridge.py',
    spawnProcess: spawnProcess as never,
    now: options.now,
    createEpoch: () => epochs.shift() ?? 'epoch-fallback',
  });
  activeBridges.push(bridge);
  return { bridge, children, spawnProcess };
}

afterEach(async () => {
  for (const bridge of activeBridges.splice(0)) await bridge.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CodexMicroNativeBridge', () => {
  it('launches only the packaged helper and exposes bounded safe status metadata', () => {
    const { bridge, children, spawnProcess } = createHarness();
    const statuses: unknown[] = [];
    bridge.onStatus((status) => statuses.push(status));

    bridge.start();

    expect(spawnProcess).toHaveBeenCalledWith(
      '/usr/bin/python3',
      ['/package/dist/hardware/codex-micro-bridge.py', '--watch'],
      expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    send(children[0], {
      type: 'status',
      state: 'connected',
      ownership: 'guarded',
      transport: 'USB',
      firmware: 'v0.4.1',
      battery: 104.6,
      charging: true,
      serial: 'must-not-cross-the-boundary',
    });

    expect(bridge.status).toEqual({
      state: 'connected',
      transport: 'usb',
      connectionEpoch: 'epoch-1',
      ownership: 'guarded',
      firmware: 'v0.4.1',
      battery: 100,
      charging: true,
    });
    expect(JSON.stringify(statuses)).not.toContain('must-not-cross-the-boundary');
  });

  it('emits edge-only keys, every encoder tick, deduped wide-key input, and armed joystick directions', () => {
    let now = 10_000;
    const { bridge, children } = createHarness({ now: () => now });
    const events: Array<{
      input: string;
      action: string;
      sequence: number;
      connectionEpoch: string;
      receivedAt: number;
    }> = [];
    bridge.onInput((event) => events.push(event));
    bridge.start();
    const [child] = children;
    send(child, { type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb' });

    send(child, { type: 'input', input: 'AG00', act: 1 });
    send(child, { type: 'input', input: 'AG00', act: 1 });
    send(child, { type: 'input', input: 'AG00', act: 0 });
    send(child, { type: 'input', input: 'AG00', phase: 'press' });
    send(child, { type: 'input', input: 'ENC_CW', act: 0 });
    send(child, { type: 'input', input: 'ACT10', act: 1 });
    send(child, { type: 'input', input: 'ACT11', act: 1 });
    now += 101;
    send(child, { type: 'input', input: 'ACT11', act: 0 });
    send(child, { type: 'input', input: 'ACT11', act: 1 });

    send(child, { type: 'joystick', angle: 0, distance: 0.7 });
    send(child, { type: 'joystick', angle: 0.25, distance: 0.9 });
    send(child, { type: 'joystick', angle: 0.25, distance: 0.44 });
    send(child, { type: 'joystick', angle: 0.25, distance: 0.6 });
    send(child, { type: 'input', input: 'UNKNOWN', act: 1 });

    expect(events.map(({ input, action }) => [input, action])).toEqual([
      ['AG00', 'focus-panel-1'],
      ['AG00', 'focus-panel-1'],
      ['ENC_CW', 'next-panel'],
      ['ACT10', 'open-activity'],
      ['ACT11', 'open-activity'],
      ['JOY_RIGHT', 'next-panel'],
      ['JOY_DOWN', 'next-page'],
    ]);
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.every(({ connectionEpoch }) => connectionEpoch === 'epoch-1')).toBe(true);
    expect(events.at(-1)?.receivedAt).toBe(10_101);
  });

  it('assigns a new local epoch only after a disconnect and ignores input while disconnected', () => {
    const { bridge, children } = createHarness({ epochs: ['first-epoch', 'second-epoch'] });
    const events: Array<{ connectionEpoch: string }> = [];
    bridge.onInput((event) => events.push(event));
    bridge.start();
    const [child] = children;

    send(child, {
      type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb', firmware: 'v0.4.1',
    });
    expect(bridge.status.connectionEpoch).toBe('first-epoch');
    send(child, {
      type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb', firmware: 'v0.4.2',
    });
    expect(bridge.status.connectionEpoch).toBe('first-epoch');
    send(child, { type: 'input', input: 'AG01', act: 1 });

    send(child, { type: 'status', state: 'disconnected', detail: ' unplugged\u0007 ' });
    send(child, { type: 'input', input: 'AG02', act: 1 });
    expect(bridge.status).toMatchObject({
      state: 'disconnected',
      connectionEpoch: null,
      detail: 'unplugged',
    });

    send(child, { type: 'status', state: 'connected', ownership: 'guarded', transport: 'ble' });
    send(child, { type: 'input', input: 'AG02', act: 1 });

    expect(bridge.status).toMatchObject({
      state: 'connected',
      transport: 'bluetooth',
      connectionEpoch: 'second-epoch',
    });
    expect(events.map(({ connectionEpoch }) => connectionEpoch)).toEqual([
      'first-epoch',
      'second-epoch',
    ]);
  });

  it('pauses without restarting while another reader is active and resumes with a fresh epoch', async () => {
    vi.useFakeTimers();
    const { bridge, children, spawnProcess } = createHarness({
      epochs: ['first-epoch', 'second-epoch'],
    });
    const statuses: Array<{ state: string; detail?: string }> = [];
    const events: Array<{ input: string; connectionEpoch: string }> = [];
    bridge.onStatus((status) => statuses.push(status));
    bridge.onInput((event) => events.push(event));
    bridge.start();
    const [child] = children;

    send(child, {
      type: 'status', state: 'busy', transport: 'usb', detail: 'another_hid_client\u0007',
    });
    send(child, { type: 'status', state: 'busy', transport: 'usb', detail: 'another_hid_client' });
    send(child, { type: 'input', input: 'AG00', act: 1 });
    send(child, { type: 'joystick', angle: 0, distance: 1 });
    await vi.advanceTimersByTimeAsync(6_000);

    expect(bridge.status).toMatchObject({
      state: 'busy',
      transport: 'usb',
      connectionEpoch: null,
      detail: 'another_hid_client',
    });
    expect(statuses.filter(({ state }) => state === 'busy')).toHaveLength(1);
    expect(events).toEqual([]);
    expect(child.kill).not.toHaveBeenCalled();
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    send(child, {
      type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb',
    });
    send(child, { type: 'input', input: 'AG00', act: 1 });
    send(child, { type: 'status', state: 'busy', transport: 'usb', detail: 'another_hid_client' });
    send(child, { type: 'input', input: 'AG01', act: 1 });
    send(child, {
      type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb',
    });
    send(child, { type: 'input', input: 'AG00', act: 1 });

    expect(events.map(({ input, connectionEpoch }) => ({ input, connectionEpoch }))).toEqual([
      { input: 'AG00', connectionEpoch: 'first-epoch' },
      { input: 'AG00', connectionEpoch: 'second-epoch' },
    ]);
  });

  it('rejects a connected helper record without the sole-reader guard attestation', () => {
    const { bridge, children } = createHarness();
    const events: unknown[] = [];
    bridge.onInput((event) => events.push(event));
    bridge.start();
    const [child] = children;

    send(child, { type: 'status', state: 'connected', transport: 'usb' });
    send(child, { type: 'input', input: 'AG00', act: 1 });

    expect(bridge.status).toEqual({
      state: 'error',
      transport: 'usb',
      connectionEpoch: null,
      detail: 'Native helper did not confirm the sole-reader guard',
    });
    expect(events).toEqual([]);
  });

  it('ignores malformed and oversized records and terminates an unbounded stream', () => {
    const { bridge, children } = createHarness();
    bridge.start();
    const [child] = children;

    child.stdout.write('not-json\n');
    child.stdout.write(`${JSON.stringify({ version: 2, type: 'status', state: 'connected' })}\n`);
    expect(bridge.status.state).toBe('starting');
    child.stdout.write(`${'x'.repeat(9 * 1024)}\n`);
    send(child, { type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb' });
    expect(bridge.status.state).toBe('connected');
    expect(child.kill).not.toHaveBeenCalled();

    child.stdout.write('x'.repeat(65 * 1024));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('stops the helper cooperatively and never restarts it after shutdown', async () => {
    vi.useFakeTimers();
    const { bridge, children, spawnProcess } = createHarness();
    bridge.start();
    const [child] = children;
    send(child, { type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb' });

    await bridge.stop();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(child.stdin.writableEnded).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it('force-kills a helper that ignores the startup-timeout SIGTERM', async () => {
    vi.useFakeTimers();
    const { bridge, children } = createHarness();
    bridge.start();
    const [child] = children;
    child.kill.mockImplementation((signal: NodeJS.Signals = 'SIGTERM') => {
      if (signal !== 'SIGKILL') return true;
      child.signalCode = signal;
      child.emit('close', null, signal);
      return true;
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(bridge.status.state).toBe('error');
  });

  it('quarantines late records while a breached helper is terminating', async () => {
    vi.useFakeTimers();
    const { bridge, children } = createHarness();
    const events: unknown[] = [];
    bridge.onInput((event) => events.push(event));
    bridge.start();
    const [child] = children;
    send(child, { type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb' });
    expect(bridge.status.connectionEpoch).toBe('epoch-1');
    child.kill.mockImplementation((signal: NodeJS.Signals = 'SIGTERM') => {
      if (signal !== 'SIGKILL') return true;
      child.signalCode = signal;
      child.emit('close', null, signal);
      return true;
    });

    child.stdout.write('x'.repeat(65 * 1024));
    expect(bridge.status).toMatchObject({
      state: 'error',
      connectionEpoch: null,
      detail: 'Native helper exceeded its bounded output buffer',
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    send(child, { type: 'status', state: 'connected', ownership: 'guarded', transport: 'usb' });
    send(child, { type: 'input', input: 'AG00', act: 1 });
    expect(bridge.status.state).toBe('error');
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('fails closed without spawning on unsupported platforms or missing assets', () => {
    const spawnProcess = vi.fn();
    const linux = new CodexMicroNativeBridge({
      platform: 'linux',
      pythonPath: '/usr/bin/python3',
      helperPath: '/bridge.py',
      spawnProcess: spawnProcess as never,
    });
    const missingPython = new CodexMicroNativeBridge({
      platform: 'darwin',
      pythonPath: null,
      helperPath: '/bridge.py',
      spawnProcess: spawnProcess as never,
    });
    activeBridges.push(linux, missingPython);

    linux.start();
    missingPython.start();

    expect(linux.status).toMatchObject({ state: 'unavailable', connectionEpoch: null });
    expect(missingPython.status).toMatchObject({
      state: 'unavailable',
      detail: 'Python 3 was not found',
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
