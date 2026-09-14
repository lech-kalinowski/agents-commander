import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../src/agents/opencode-protocol-plugin.js';

const socketHarness = vi.hoisted(() => ({ create: vi.fn() }));
const fsHarness = vi.hoisted(() => ({ createReadStream: vi.fn(), fstatSync: vi.fn(), write: vi.fn() }));
vi.mock('node:net', () => ({
  Socket: class {
    constructor(options: unknown) { return socketHarness.create(options); }
  },
}));
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  ...fsHarness,
}));

const token = 't'.repeat(43);
const capability = 'a'.repeat(43);
const otherCapability = 'b'.repeat(43);
const disposers: Array<() => Promise<void>> = [];
const originalBunVersion = Object.getOwnPropertyDescriptor(process.versions, 'bun');

async function bunFixture(options: { invalidDescriptor?: boolean } = {}) {
  Object.defineProperty(process.versions, 'bun', { value: '1.3.8', configurable: true });
  vi.stubEnv('AGENTS_COMMANDER_OPENCODE_TOKEN', token);
  vi.stubEnv('AGENTS_COMMANDER_OPENCODE_FD', '4');
  const reader = Object.assign(new EventEmitter(), {
    destroyed: false,
    destroy: vi.fn(function(this: any) {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('close');
    }),
  });
  const writes: Array<{ bytes: Buffer; offset: number; length: number; callback: (error: Error | null, count: number) => void }> = [];
  const wire: Buffer[] = [];
  fsHarness.fstatSync.mockReturnValue({ isSocket: () => !options.invalidDescriptor });
  fsHarness.createReadStream.mockReturnValue(reader);
  fsHarness.write.mockImplementation((fd, bytes, offset, length, position, callback) => {
    expect(fd).toBe(4);
    expect(position).toBeNull();
    writes.push({ bytes, offset, length, callback });
  });
  const hooks = await plugin() as any;
  if (hooks.dispose) disposers.push(hooks.dispose);
  function drain(maxChunk = 65536) {
    while (writes.length) {
      const next = writes.shift()!;
      const count = Math.min(next.length, maxChunk);
      wire.push(next.bytes.subarray(next.offset, next.offset + count));
      next.callback(null, count);
    }
  }
  async function armAndBind() {
    reader.emit('data', Buffer.from(JSON.stringify({ v: 1, type: 'arm', token, capability, epoch: 1 }) + '\n'));
    await hooks['chat.message'](...user());
  }
  return { hooks, reader, writes, wire, drain, armAndBind };
}

function instructions(key = capability) {
  return `[Agents Commander] You are OpenCode in Panel 1.\n`
    + `Protocol capability: ${key}. Include it on every protocol header and footer exactly as shown below.\n`
    + 'Other instructions are not retained by this shim.';
}

function user(sessionID = 'ses_123', text = instructions(), extraPart: Record<string, unknown> = {}) {
  return [{ sessionID }, {
    message: { role: 'user', sessionID },
    parts: [{ type: 'text', text, ...extraPart }],
  }] as const;
}

function completed(text = '===COMMANDER:BROADCAST:synthetic===\nhello', sessionID = 'ses_123') {
  return [{ sessionID, messageID: 'msg_123', partID: 'prt_123' }, { text }] as const;
}

async function fixture(options: { paused?: boolean; badSocket?: boolean } = {}) {
  vi.stubEnv('AGENTS_COMMANDER_OPENCODE_TOKEN', token);
  vi.stubEnv('AGENTS_COMMANDER_OPENCODE_FD', '4');
  const records: any[] = [];
  const callbacks: Array<(error?: Error) => void> = [];
  const socket = Object.assign(new EventEmitter(), {
    write: vi.fn((encoded: string, callback: (error?: Error) => void) => {
      records.push(JSON.parse(encoded));
      if (options.paused) callbacks.push(callback);
      else queueMicrotask(callback);
      return true;
    }),
    destroy: vi.fn(), unref: vi.fn(),
  });
  socketHarness.create.mockImplementation(() => {
    if (options.badSocket) throw new Error('inherited descriptor unavailable');
    return socket;
  });
  const hooks = await plugin() as any;
  if (hooks.dispose) disposers.push(hooks.dispose);
  async function sendArm(fields: Record<string, unknown> = {}) {
    socket.emit('data', Buffer.from(JSON.stringify({ v: 1, type: 'arm', token, capability, epoch: 1, ...fields }) + '\n'));
    await Promise.resolve();
    await Promise.resolve();
  }
  async function armAndBind() {
    await sendArm();
    await hooks['chat.message'](...user());
    await Promise.resolve();
  }
  return { hooks, socket, records, callbacks, sendArm, armAndBind };
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  vi.unstubAllEnvs();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  if (originalBunVersion) Object.defineProperty(process.versions, 'bun', originalBunVersion);
  else delete (process.versions as Record<string, string | undefined>).bun;
});

describe('bundled OpenCode semantic protocol plugin', () => {
  it('exports only the plugin function and does nothing without a valid inherited channel', async () => {
    const module = await import('../../src/agents/opencode-protocol-plugin.js');
    expect(Object.keys(module)).toEqual(['default']);
    vi.stubEnv('AGENTS_COMMANDER_OPENCODE_TOKEN', 'invalid');
    vi.stubEnv('AGENTS_COMMANDER_OPENCODE_FD', '4');
    expect(await plugin()).toEqual({});
    expect(socketHarness.create).not.toHaveBeenCalled();
    expect(process.env.AGENTS_COMMANDER_OPENCODE_TOKEN).toBeUndefined();
    expect(process.env.AGENTS_COMMANDER_OPENCODE_FD).toBeUndefined();
  });

  it('fails safely when opening the inherited descriptor fails', async () => {
    const f = await fixture({ badSocket: true });
    expect(f.hooks).toEqual({});
    expect(f.records).toEqual([]);
  });

  it('authenticates its hello, removes inherited secrets, and acknowledges a parent arm', async () => {
    const f = await fixture();
    expect(socketHarness.create).toHaveBeenCalledWith({ fd: 4, readable: true, writable: true });
    expect(f.records).toEqual([{ v: 1, token, type: 'hello' }]);
    expect(process.env.AGENTS_COMMANDER_OPENCODE_TOKEN).toBeUndefined();
    expect(process.env.AGENTS_COMMANDER_OPENCODE_FD).toBeUndefined();
    await f.sendArm();
    expect(f.records.at(-1)).toEqual({ v: 1, token, type: 'armed', capability, epoch: 1 });
  });

  it('binds only exact injected protocol instructions and forwards an intact long completed part', async () => {
    const f = await fixture();
    await f.armAndBind();
    expect(f.records.at(-1)).toEqual({ v: 1, token, type: 'bound', capability, epoch: 1, sessionID: 'ses_123' });
    const text = `===COMMANDER:BROADCAST:${capability}:1===\n`
      + Array.from({ length: 80 }, (_, i) => `  preserved ${i}: wide: 界, blank:   `).join('\n')
      + `\n===COMMANDER:END:${capability}:1===`;
    const [input, output] = completed(text);
    await f.hooks['experimental.text.complete'](input, output);
    expect(f.records.at(-1)).toEqual({ v: 1, token, type: 'text', capability, epoch: 1,
      sessionID: 'ses_123', messageID: 'msg_123', partID: 'prt_123', text });
    expect(output.text).toBe(text);
    expect(f.hooks.event).toBeUndefined();
  });

  it.each(['SEND:opencode:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])(
    'does not mutate the completed %s part', async (kind) => {
      const f = await fixture();
      await f.armAndBind();
      const text = `===COMMANDER:${kind}:${capability}:1===\nhello\n===COMMANDER:END:${capability}:1===`;
      await f.hooks['experimental.text.complete'](...completed(text));
      expect(f.records.at(-1).text).toBe(text);
    },
  );

  it('handles one early protocol candidate without retaining or sending the user prompt', async () => {
    const f = await fixture();
    await f.hooks['chat.message'](...user());
    expect(f.records).toHaveLength(1);
    await f.sendArm();
    expect(f.records.map((record) => record.type)).toEqual(['hello', 'armed', 'bound']);
    expect(JSON.stringify(f.records)).not.toContain('Other instructions');
  });

  it('keeps only the latest candidate and will not bind a different capability', async () => {
    const f = await fixture();
    await f.hooks['chat.message'](...user());
    await f.hooks['chat.message'](...user('ses_other', instructions(otherCapability)));
    await f.sendArm();
    expect(f.records.some((record) => record.type === 'bound')).toBe(false);
    await f.hooks['experimental.text.complete'](...completed());
    expect(f.records.some((record) => record.type === 'text')).toBe(false);
  });

  it.each([
    { synthetic: true }, { ignored: true }, { type: 'tool' }, { sessionID: 'ses_wrong' },
  ])('never binds synthetic, ignored, or non-text content: %j', async (extra) => {
    const f = await fixture();
    await f.sendArm();
    await f.hooks['chat.message'](...user('ses_123', instructions(), extra));
    expect(f.records.some((record) => record.type === 'bound')).toBe(false);
  });

  it('rejects quoted and malformed capability instructions, assistant roles and inconsistent sessions', async () => {
    const f = await fixture();
    await f.sendArm();
    for (const text of [`Example: ${instructions()}`, instructions().replace('Protocol capability:', 'Protocol key:'),
      instructions().replace('exactly as shown below.', 'exactly as shown below.x')]) {
      await f.hooks['chat.message'](...user('ses_123', text));
    }
    const [input, output] = user();
    await f.hooks['chat.message'](input, { ...output, message: { role: 'assistant', sessionID: input.sessionID } });
    await f.hooks['chat.message'](input, { ...output, message: { role: 'user', sessionID: 'ses_wrong' } });
    expect(f.records.some((record) => record.type === 'bound')).toBe(false);
  });

  it('ignores unbound, unrelated-session and ordinary non-protocol completed text', async () => {
    const f = await fixture();
    await f.hooks['experimental.text.complete'](...completed());
    await f.armAndBind();
    await f.hooks['experimental.text.complete'](...completed('ordinary assistant answer'));
    await f.hooks['experimental.text.complete'](...completed(undefined, 'ses_other'));
    expect(f.records.some((record) => record.type === 'text')).toBe(false);
  });

  it('requires bounded string session/message/part identifiers rather than coercing other types', async () => {
    const f = await fixture();
    await f.sendArm();
    await f.hooks['chat.message']({ sessionID: 123 }, {
      message: { role: 'user', sessionID: 123 }, parts: [{ type: 'text', text: instructions() }],
    });
    expect(f.records.some((record) => record.type === 'bound')).toBe(false);
    await f.hooks['chat.message'](...user());
    const [input, output] = completed();
    await f.hooks['experimental.text.complete']({ ...input, messageID: 123 }, output);
    await f.hooks['experimental.text.complete']({ ...input, partID: 'x'.repeat(161) }, output);
    expect(f.records.some((record) => record.type === 'text')).toBe(false);
  });

  it('disables a mismatched session until a new arm and never silently rebinds', async () => {
    const f = await fixture();
    await f.armAndBind();
    await f.hooks['chat.message'](...user('ses_other'));
    expect(f.records.at(-1)).toEqual({ v: 1, token, type: 'error', code: 'session-mismatch', capability, epoch: 1 });
    await f.sendArm(); // A duplicate is not a fresh authority to follow another session.
    await f.hooks['chat.message'](...user('ses_other'));
    await f.hooks['experimental.text.complete'](...completed());
    expect(f.records.filter((record) => record.type === 'bound')).toHaveLength(1);
    expect(f.records.some((record) => record.type === 'text')).toBe(false);
    await f.sendArm({ epoch: 2, capability: otherCapability });
    await f.hooks['chat.message'](...user('ses_other', instructions(otherCapability)));
    await f.hooks['experimental.text.complete'](...completed(undefined, 'ses_other'));
    expect(f.records.at(-1)).toMatchObject({ type: 'text', epoch: 2, capability: otherCapability, sessionID: 'ses_other' });
  });

  it('ignores ordinary subagent chat and completed text without disabling the bound parent', async () => {
    const f = await fixture();
    await f.armAndBind();
    await f.hooks['chat.message'](...user('ses_child', 'Inspect the parser and report results to the parent.'));
    await f.hooks['chat.message'](...user('ses_child', instructions(otherCapability)));
    await f.hooks['experimental.text.complete'](...completed(undefined, 'ses_child'));
    expect(f.records.some((record) => record.type === 'error' || record.type === 'text')).toBe(false);
    await f.hooks['experimental.text.complete'](...completed());
    expect(f.records.at(-1)).toMatchObject({ type: 'text', sessionID: 'ses_123', capability, epoch: 1 });
    expect(f.records.filter((record) => record.type === 'bound')).toHaveLength(1);
  });

  it.each([false, true])('retains a bounded prompt-before-arm rotation candidate, failed epoch=%s', async (failed) => {
    const f = await fixture();
    await f.armAndBind();
    if (failed) await f.hooks['chat.message'](...user('ses_mismatch'));
    await f.hooks['chat.message'](...user('ses_rotated', instructions(otherCapability)));
    await f.hooks['experimental.text.complete'](...completed(undefined, 'ses_rotated'));
    expect(f.records.filter((record) => record.type === 'bound')).toHaveLength(1);
    expect(f.records.some((record) => record.type === 'text')).toBe(false);
    // A duplicate old arm must not destroy a pending future-capability prompt.
    await f.sendArm();
    await f.sendArm({ epoch: 2, capability: otherCapability });
    expect(f.records.at(-1)).toMatchObject({ type: 'bound', sessionID: 'ses_rotated', capability: otherCapability, epoch: 2 });
    await f.hooks['experimental.text.complete'](...completed(undefined, 'ses_rotated'));
    expect(f.records.at(-1)).toMatchObject({ type: 'text', sessionID: 'ses_rotated', capability: otherCapability, epoch: 2 });
    expect(JSON.stringify(f.records)).not.toContain('Other instructions');
  });

  it.each([
    { token: 'x'.repeat(43) }, { v: 2 }, { type: 'text' }, { epoch: 0 },
    { epoch: Number.MAX_SAFE_INTEGER + 1 }, { capability: 'short' },
  ])('closes on invalid parent authentication/schema: %j', async (fields) => {
    const f = await fixture();
    await f.sendArm(fields);
    expect(f.socket.destroy).toHaveBeenCalledOnce();
    expect(f.records).toHaveLength(1);
  });

  it('supports split JSON lines, but rejects oversized/invalid input and old epochs', async () => {
    const f = await fixture();
    const line = JSON.stringify({ v: 1, type: 'arm', token, capability, epoch: 2 }) + '\n';
    f.socket.emit('data', Buffer.from(line.slice(0, 20)));
    f.socket.emit('data', Buffer.from(line.slice(20)));
    await Promise.resolve();
    expect(f.records.at(-1)).toMatchObject({ type: 'armed', epoch: 2 });
    await f.sendArm({ epoch: 1 });
    expect(f.socket.destroy).toHaveBeenCalledOnce();
    const oversized = await fixture();
    oversized.socket.emit('data', Buffer.alloc(8193, 120));
    expect(oversized.socket.destroy).toHaveBeenCalledOnce();
    const malformed = await fixture();
    malformed.socket.emit('data', Buffer.from('{invalid}\n'));
    expect(malformed.socket.destroy).toHaveBeenCalledOnce();
  });

  it('reports oversized text without sending any part of it, then requires a new arm', async () => {
    const f = await fixture();
    await f.armAndBind();
    await f.hooks['experimental.text.complete'](...completed('COMMANDER' + 'x'.repeat(1024 * 1024)));
    expect(f.records.at(-1)).toMatchObject({ type: 'error', code: 'oversized-text', epoch: 1 });
    await f.hooks['experimental.text.complete'](...completed());
    expect(f.records.some((record) => record.type === 'text')).toBe(false);
  });

  it('bounds stalled writes to two seconds and resolves hooks on disposal/error', async () => {
    vi.useFakeTimers();
    const f = await fixture({ paused: true });
    await f.sendArm();
    await f.hooks['chat.message'](...user());
    const done = vi.fn();
    const waiting = f.hooks['experimental.text.complete'](...completed()).then(done);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.socket.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(f.socket.destroy).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
    // A late OS write callback cannot revive the closed channel.
    f.callbacks[0]?.();
    await f.hooks.dispose();
    expect(f.socket.destroy).toHaveBeenCalledOnce();
  });

  it('bounds queued and in-flight encoded data, including JSON escaping expansion', async () => {
    const f = await fixture({ paused: true });
    await f.sendArm();
    await f.hooks['chat.message'](...user());
    // Each raw part fits 1MiB but NUL escaping expands it to about6MiB JSON.
    const text = 'COMMANDER' + '\0'.repeat(1024 * 1024 - 9);
    const first = f.hooks['experimental.text.complete'](...completed(text));
    const second = f.hooks['experimental.text.complete'](...completed(text));
    await Promise.all([first, second]);
    expect(f.socket.destroy).toHaveBeenCalledOnce();
    expect(f.records).toHaveLength(1); // Only the already in-flight hello was written.
  });

  it('removes bridge authority from shell environments without touching other settings', async () => {
    const f = await fixture();
    const output = { env: { AGENTS_COMMANDER_OPENCODE_TOKEN: token, AGENTS_COMMANDER_OPENCODE_FD: '4', KEEP: 'yes' } };
    await f.hooks['shell.env']({}, output);
    expect(output.env).toEqual({ KEEP: 'yes' });
    f.socket.emit('error', new Error('synthetic transport failure'));
    await f.hooks['experimental.text.complete'](...completed());
    expect(f.socket.destroy).toHaveBeenCalledOnce();
  });
});

describe('Bun inherited-fd transport edge cases', () => {
  it('refuses to interpret a non-socket descriptor as the private transport', async () => {
    const f = await bunFixture({ invalidDescriptor: true });
    expect(f.hooks).toEqual({});
    expect(fsHarness.createReadStream).not.toHaveBeenCalled();
    expect(fsHarness.write).not.toHaveBeenCalled();
  });

  it('retries partial raw writes without dropping or duplicating bytes across records', async () => {
    const f = await bunFixture();
    expect(socketHarness.create).not.toHaveBeenCalled();
    expect(fsHarness.createReadStream).toHaveBeenCalledWith('', { fd: 4, autoClose: true, highWaterMark: 8192 });
    await f.armAndBind();
    const text = 'COMMANDER\n  Unicode: 界 🚀 café\n  exact spaces:   ';
    const completion = f.hooks['experimental.text.complete'](...completed(text));
    f.drain(7);
    await completion;
    const records = Buffer.concat(f.wire).toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(records.map((record) => record.type)).toEqual(['hello', 'armed', 'bound', 'text']);
    expect(records.at(-1).text).toBe(text);
    expect(f.reader.destroyed).toBe(false);
    expect(fsHarness.write.mock.calls.length).toBeGreaterThan(10);
  });

  it.each(['zero', 'error'])('settles queued hooks and closes once on a raw write %s', async (mode) => {
    const f = await bunFixture();
    await f.armAndBind();
    const settled = vi.fn();
    const pending = f.hooks['experimental.text.complete'](...completed()).then(settled);
    const first = f.writes.shift()!;
    first.callback(mode === 'error' ? new Error('synthetic write failure') : null, 0);
    await pending;
    expect(settled).toHaveBeenCalledOnce();
    expect(f.reader.destroy).toHaveBeenCalledOnce();
    const count = fsHarness.write.mock.calls.length;
    await f.hooks['experimental.text.complete'](...completed());
    expect(fsHarness.write.mock.calls.length).toBe(count);
  });

  it('never resumes a partial write after its descriptor owner closes', async () => {
    const f = await bunFixture();
    await f.armAndBind();
    const settled = vi.fn();
    const pending = f.hooks['experimental.text.complete'](...completed()).then(settled);
    const first = f.writes.shift()!;
    const writeCount = fsHarness.write.mock.calls.length;
    f.reader.destroy();
    await pending;
    first.callback(null, 5); // Late completion of a previously submitted write.
    expect(settled).toHaveBeenCalledOnce();
    expect(fsHarness.write.mock.calls.length).toBe(writeCount);
    expect(f.reader.destroy).toHaveBeenCalledTimes(2); // External close plus idempotent plugin close.
  });

  it('has a two-second bound even if the raw write callback never arrives', async () => {
    vi.useFakeTimers();
    const f = await bunFixture();
    await f.armAndBind();
    const pending = f.hooks['experimental.text.complete'](...completed());
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(f.reader.destroyed).toBe(true);
    const writeCount = fsHarness.write.mock.calls.length;
    f.writes.shift()!.callback(null, 5);
    expect(fsHarness.write.mock.calls.length).toBe(writeCount);
  });

  it('contains a synchronous raw-write exception without rejecting OpenCode hooks', async () => {
    const f = await bunFixture();
    f.drain(); // Finish the initial hello before the simulated OS failure.
    fsHarness.write.mockImplementation(() => { throw new Error('synthetic synchronous write failure'); });
    await expect(f.armAndBind()).resolves.toBeUndefined();
    await expect(f.hooks['experimental.text.complete'](...completed())).resolves.toBeUndefined();
    expect(f.reader.destroyed).toBe(true);
  });
});
