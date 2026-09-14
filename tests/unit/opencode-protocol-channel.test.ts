import { Duplex } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeProtocolChannel, withOpenCodeProtocolPlugin } from '../../src/agents/opencode-protocol-channel.js';

const capability = 'a'.repeat(43);
const nextCapability = 'b'.repeat(43);
const cleanups: Array<() => void> = [];

function fixture() {
  const onText = vi.fn();
  const onState = vi.fn();
  const writes: any[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      writes.push(JSON.parse(chunk.toString('utf8')));
      callback();
    },
  });
  const channel = new OpenCodeProtocolChannel(onText, onState);
  channel.attach(stream);
  cleanups.push(() => channel.dispose());
  const peer = (fields: Record<string, unknown>) => stream.emit('data', Buffer.from(
    JSON.stringify({ v: 1, token: channel.token, ...fields }) + '\n',
  ));
  const envelope = (fields: Record<string, unknown> = {}) => ({
    type: 'text', capability, epoch: 1, sessionID: 'ses_fixture',
    messageID: 'msg_fixture', partID: 'prt_fixture', text: 'COMMANDER source text', ...fields,
  });
  const ready = () => {
    channel.arm(capability);
    peer({ type: 'hello' });
    peer({ type: 'armed', capability, epoch: 1 });
    peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_fixture' });
  };
  return { channel, stream, onText, onState, writes, peer, envelope, ready };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('launch-local OpenCode plugin configuration', () => {
  it('preserves provider/model/permissions and configured plugins without mutating the supplied environment', () => {
    const config = { model: 'callstack/apex', provider: { callstack: { models: { apex: {} } } },
      permission: { '*': 'deny' }, plugin: ['existing-plugin', ['option-plugin', { setting: true }]] };
    const env = { KEEP: 'present', OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_CONFIG: '/existing/custom.json', AGENTS_COMMANDER_OPENCODE_TOKEN: 'stale' };
    const before = structuredClone(env);
    const pluginPath = '/synthetic/package with spaces/dist/agents/opencode-protocol-plugin.js';
    const result = withOpenCodeProtocolPlugin(env, pluginPath, 't'.repeat(43));
    expect(env).toEqual(before);
    expect(JSON.parse(result.OPENCODE_CONFIG_CONTENT!)).toEqual({ ...config,
      plugin: [...config.plugin, pathToFileURL(pluginPath).href] });
    expect(result).toMatchObject({ KEEP: 'present', OPENCODE_CONFIG: '/existing/custom.json',
      AGENTS_COMMANDER_OPENCODE_TOKEN: 't'.repeat(43), AGENTS_COMMANDER_OPENCODE_FD: '4' });
    expect(withOpenCodeProtocolPlugin(result, pluginPath, 't'.repeat(43))).toEqual(result);
  });

  it('creates only a launch-local plugin array when inline config is absent or blank', () => {
    for (const content of [undefined, '', '   ']) {
      const result = withOpenCodeProtocolPlugin({ OPENCODE_CONFIG_CONTENT: content }, '/synthetic/plugin.js', 't'.repeat(43));
      expect(JSON.parse(result.OPENCODE_CONFIG_CONTENT!)).toEqual({ plugin: ['file:///synthetic/plugin.js'] });
    }
  });

  it.each(['invalid', '[]', 'null', '4', '"config"', '{"plugin":"plugin-name"}'])(
    'fails clearly rather than replacing malformed inline configuration: %s', (value) => {
      expect(() => withOpenCodeProtocolPlugin({ OPENCODE_CONFIG_CONTENT: value }, '/synthetic/plugin.js', 't'.repeat(43)))
        .toThrow(/configuration/);
    },
  );
});

describe('OpenCode parent semantic protocol channel', () => {
  it('requires hello before setup and sends a private arm with exact capability/epoch', () => {
    const f = fixture();
    expect(f.channel.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.channel.setupError).toMatch(/connecting/);
    f.channel.arm(capability);
    expect(f.writes).toEqual([]);
    f.peer({ type: 'hello' });
    expect(f.channel.setupError).toBeNull();
    expect(f.writes).toEqual([{ v: 1, token: f.channel.token, type: 'arm', capability, epoch: 1 }]);
    f.peer({ type: 'armed', capability, epoch: 1 });
    f.peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_fixture' });
    expect(f.channel.status).toBeNull();
    f.peer(f.envelope());
    expect(f.onText).toHaveBeenCalledExactlyOnceWith({ sessionID: 'ses_fixture', messageID: 'msg_fixture',
      partID: 'prt_fixture', text: 'COMMANDER source text' });
  });

  it('ignores text before arm acknowledgment, before binding and from unrelated sessions', () => {
    const f = fixture();
    f.channel.arm(capability);
    f.peer({ type: 'hello' });
    f.peer(f.envelope());
    f.peer({ type: 'armed', capability, epoch: 1 });
    f.peer(f.envelope());
    f.peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_fixture' });
    f.peer(f.envelope({ sessionID: 'ses_child' }));
    expect(f.onText).not.toHaveBeenCalled();
    expect(f.stream.destroyed).toBe(false);
  });

  it('preserves Unicode through byte-level fragmented JSON records', () => {
    const f = fixture();
    f.ready();
    const text = 'COMMANDER\n  界 🚀 café\n  preserved spacing:   \n\u0000';
    const wire = Buffer.from(JSON.stringify({ v: 1, token: f.channel.token, ...f.envelope({ text }) }) + '\n');
    for (const byte of wire) f.stream.emit('data', Buffer.from([byte]));
    expect(f.onText).toHaveBeenCalledOnce();
    expect(f.onText.mock.calls[0][0].text).toBe(text);
  });

  it('scans fragmented large input linearly and releases oversized accumulation buffers after dispatch', () => {
    const f = fixture();
    f.ready();
    const text = 'x'.repeat(256 * 1024);
    const wire = Buffer.from(JSON.stringify({ v: 1, token: f.channel.token, ...f.envelope({ text }) }) + '\n');
    const originalStringIndexOf = String.prototype.indexOf;
    const originalBufferIndexOf = Buffer.prototype.indexOf;
    let searchWork = 0;
    // Deterministic work accounting, not a hardware-dependent timing threshold.
    // The former implementation rescanned about538MiB for this256KiB record.
    const stringProbe = vi.spyOn(String.prototype, 'indexOf').mockImplementation(function(this: string, search, position) {
      if (search === '\n') searchWork += Math.max(0, this.length - (position ?? 0));
      return originalStringIndexOf.call(this, search, position);
    });
    const bufferProbe = vi.spyOn(Buffer.prototype, 'indexOf').mockImplementation(function(this: Buffer, value: any, offset: any, encoding: any) {
      if (value === 10 || value === '\n') searchWork += Math.max(0, this.length - (typeof offset === 'number' ? offset : 0));
      return originalBufferIndexOf.call(this, value, offset, encoding);
    });
    try {
      for (let offset = 0; offset < wire.length; offset += 64) f.stream.emit('data', wire.subarray(offset, offset + 64));
    } finally {
      stringProbe.mockRestore();
      bufferProbe.mockRestore();
    }
    expect(searchWork).toBeLessThanOrEqual(wire.length * 2);
    expect(f.onText).toHaveBeenCalledOnce();
    expect(f.onText.mock.calls[0][0].text).toBe(text);
    expect((f.channel as any).pendingBytes).toBe(0);
    expect((f.channel as any).pending.length).toBe(0);
    f.peer(f.envelope({ text: 'short next record', partID: 'prt_next' }));
    expect(f.onText.mock.calls[1][0].text).toBe('short next record');
    expect((f.channel as any).pending.length).toBeLessThanOrEqual(65536);
  });

  it('never exposes unused buffer bytes when a large and short frame arrive in one chunk', () => {
    const f = fixture();
    f.ready();
    const texts = ['private fixture text'.repeat(10000), 'tiny'];
    const wire = texts.map((text, index) => JSON.stringify({ v: 1, token: f.channel.token,
      ...f.envelope({ text, partID: `prt_${index}` }) }) + '\n').join('');
    f.stream.emit('data', Buffer.from(wire));
    expect(f.onText.mock.calls.map(([event]) => event.text)).toEqual(texts);
    expect((f.channel as any).pendingBytes).toBe(0);
    f.channel.dispose();
    expect((f.channel as any).pending.length).toBe(0);
  });

  it('accepts bounded160-character identifiers without coercing invalid fields', () => {
    const f = fixture();
    f.channel.arm(capability);
    f.peer({ type: 'hello' });
    f.peer({ type: 'armed', capability, epoch: 1 });
    f.peer({ type: 'bound', capability, epoch: 1, sessionID: 's'.repeat(160) });
    f.peer(f.envelope({ sessionID: 's'.repeat(160), messageID: 'm'.repeat(160), partID: 'p'.repeat(160) }));
    expect(f.onText).toHaveBeenCalledOnce();
    f.peer(f.envelope({ sessionID: 's'.repeat(160), messageID: 123 }));
    expect(f.stream.destroyed).toBe(true);
    expect(f.onText).toHaveBeenCalledOnce();
  });

  it('invalidates queued old-epoch output and requires a fresh binding after rotation', () => {
    const f = fixture();
    f.ready();
    f.channel.arm(nextCapability);
    expect(f.writes.at(-1)).toMatchObject({ capability: nextCapability, epoch: 2 });
    f.peer(f.envelope());
    f.peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_fixture' });
    f.peer({ type: 'armed', capability: nextCapability, epoch: 2 });
    f.peer(f.envelope({ capability: nextCapability, epoch: 2 }));
    expect(f.onText).not.toHaveBeenCalled();
    f.peer({ type: 'bound', capability: nextCapability, epoch: 2, sessionID: 'ses_new' });
    f.peer(f.envelope({ capability: nextCapability, epoch: 2, sessionID: 'ses_new' }));
    expect(f.onText).toHaveBeenCalledOnce();
  });

  it('latches a mismatched epoch until a fresh explicit arm, ignoring repeated old armed/bound events', () => {
    const f = fixture();
    f.ready();
    f.peer({ type: 'error', code: 'session-mismatch', capability, epoch: 1 });
    expect(f.channel.status).toMatch(/conversation changed/);
    f.peer({ type: 'armed', capability, epoch: 1 });
    f.peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_other' });
    f.peer(f.envelope({ sessionID: 'ses_other' }));
    expect(f.onText).not.toHaveBeenCalled();
    expect(f.channel.status).toMatch(/conversation changed/);
    f.channel.arm(nextCapability);
    f.peer({ type: 'armed', capability: nextCapability, epoch: 2 });
    f.peer({ type: 'bound', capability: nextCapability, epoch: 2, sessionID: 'ses_other' });
    f.peer(f.envelope({ capability: nextCapability, epoch: 2, sessionID: 'ses_other' }));
    expect(f.onText).toHaveBeenCalledOnce();
  });

  it('never silently follows a second binding in the same epoch', () => {
    const f = fixture();
    f.ready();
    f.peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_other' });
    expect(f.stream.destroyed).toBe(true);
    f.peer(f.envelope({ sessionID: 'ses_other' }));
    expect(f.onText).not.toHaveBeenCalled();
  });

  it.each([{ token: 'x'.repeat(43) }, { v: 2 }, { type: 'unknown' }, { text: null },
    { messageID: '' }, { partID: 'x'.repeat(161) }])('rejects invalid auth/schema/text: %j', (extra) => {
    const f = fixture();
    f.ready();
    f.peer(f.envelope(extra));
    expect(f.stream.destroyed).toBe(true);
    expect(f.channel.setupError).toMatch(/unavailable/);
    expect(f.onText).not.toHaveBeenCalled();
  });

  it.each(['[]\n', 'null\n', 'no-json\n'])('rejects malformed envelopes: %s', (wire) => {
    const f = fixture();
    f.stream.emit('data', Buffer.from(wire));
    expect(f.stream.destroyed).toBe(true);
  });

  it('closes on duplicate hello or pre-hello child messages', () => {
    const first = fixture();
    first.peer({ type: 'hello' });
    first.peer({ type: 'hello' });
    expect(first.stream.destroyed).toBe(true);
    const second = fixture();
    second.peer(second.envelope());
    expect(second.stream.destroyed).toBe(true);
  });

  it('bounds raw wire and decoded text sizes before dispatching any payload', () => {
    const first = fixture();
    first.stream.emit('data', Buffer.alloc(8 * 1024 * 1024 + 1, 120));
    expect(first.stream.destroyed).toBe(true);
    expect(first.channel.status).toBe('message exceeds transport limit');
    const second = fixture();
    second.ready();
    second.peer(second.envelope({ text: 'x'.repeat(1024 * 1024 + 1) }));
    expect(second.stream.destroyed).toBe(true);
    expect(second.onText).not.toHaveBeenCalled();
  });

  it.each(['end', 'close', 'error'])('fails closed on transport %s and never accepts later data', (event) => {
    const f = fixture();
    f.ready();
    f.stream.emit(event, ...(event === 'error' ? [new Error('synthetic failure')] : []));
    f.peer(f.envelope());
    expect(f.stream.destroyed).toBe(true);
    expect(f.onText).not.toHaveBeenCalled();
  });

  it('has a bounded startup timeout and cannot attach twice or arm invalid capabilities', () => {
    vi.useFakeTimers();
    const f = fixture();
    expect(() => f.channel.attach(f.stream)).toThrow(/reused/);
    expect(() => f.channel.arm('invalid')).toThrow(/Invalid protocol capability/);
    vi.advanceTimersByTime(29999);
    expect(f.stream.destroyed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(f.stream.destroyed).toBe(true);
    f.channel.dispose();
    f.channel.arm(capability);
    expect(f.writes).toEqual([]);
  });
});
