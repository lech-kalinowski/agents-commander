import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentType } from '../../src/agents/types.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { VTerm } from '../../src/panels/vterm.js';

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: childProcess.spawn,
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/utils/runtime-assets.js', () => ({
  runtimeAssetLookupForModule: vi.fn(() => ({})),
  resolvePtyHelperPath: vi.fn(() => '/synthetic/pty-helper.py'),
  resolveOpenCodeProtocolPluginPath: vi.fn(() => '/synthetic/opencode-protocol-plugin.js'),
}));

// Public synthetic identities only. No providers, user sessions, or live keys.
const capability = 'a'.repeat(43);
const otherCapability = 'b'.repeat(43);
const terminalHarnesses = ['claude', 'codex', 'gemini', 'generic'] as const;
const allHarnesses = [...terminalHarnesses, 'opencode'] as const;
const verbs = ['SEND:opencode:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'];

function frame(verb = 'SEND:opencode:2', sequence = 1, key = capability, body = 'Hi') {
  return `===COMMANDER:${verb}:${key}:${sequence}===\n${body}\n===COMMANDER:END:${key}:${sequence}===`;
}

function missingHeaderDelimiter(sequence = 1, key = capability, verb = 'SEND:opencode:2') {
  return frame(verb, sequence, key).replace(`${sequence}===\n`, `${sequence}\n`);
}

function fixture(agentType: AgentType) {
  const emitted = vi.fn();
  const protocolError = vi.fn();
  const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex: 0, agentType, agentName: `Synthetic ${agentType} harness`, cwd: '/synthetic',
    launchSealed: false, _sessionGeneration: 0, _status: 'running',
    _visible: false, box: {}, outputBox: { width: 141, height: 25 },
    vterm: new VTerm(140, 24),
    orchConfig: {
      gridScanDelay: 200, dedupWindow: 15000, ackTimeout: 60000, injectionGrace: 2500,
      maxContentLines: 500, maxContentBytes: 262144,
    },
    activeGridProtocolKeys: new Set(), activeTailReplyKeys: new Set(),
    recentEmissions: new Map(), protocolReservations: new Map(),
    pendingReplyEmissions: new Map(), instructionEchoGuardUntil: 0,
    pendingTerminations: new Set(), shutdownPromise: null,
    gridScanTimer: null, commanderActivityTimer: null,
    resolveFullPath: (command: string) => `/synthetic/${command}`,
    updateHeader: vi.fn(), scheduleRender: vi.fn(),
    onCommanderMessage: emitted, onCommanderProtocolError: protocolError,
  });
  const streams = Array.from({ length: 4 }, () => new PassThrough());
  const outbound: any[] = [];
  const bridge = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      outbound.push(JSON.parse(chunk.toString('utf8')));
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 123, stdin: streams[0], stdout: streams[1], stderr: streams[2], stdio: [...streams, bridge],
    exitCode: null, signalCode: null, kill: vi.fn(() => true),
  });
  childProcess.spawn.mockReturnValueOnce(child);
  expect(panel.launchSession('synthetic', [], {}, true, 'internal')).toBe(true);
  panel.setProtocolCapability(capability);
  const token = childProcess.spawn.mock.calls.at(-1)?.[2].env.AGENTS_COMMANDER_OPENCODE_TOKEN;
  let epoch = 1;
  let currentKey = capability;
  let nextPart = 1;
  const peer = (fields: Record<string, unknown>) => {
    bridge.emit('data', Buffer.from(JSON.stringify({ v: 1, token, ...fields }) + '\n'));
  };
  const bind = () => {
    peer({ type: 'armed', capability: currentKey, epoch });
    peer({ type: 'bound', capability: currentKey, epoch, sessionID: 'ses_feedback' });
  };
  if (agentType === 'opencode') {
    peer({ type: 'hello' });
    expect(outbound.at(-1)).toMatchObject({ type: 'arm', capability, epoch });
    bind();
  }
  const output = (text: string) => {
    child.stdout.emit('data', Buffer.from(text));
    vi.advanceTimersByTime(250);
  };
  return {
    panel, emitted, protocolError, child, output,
    authored(text: string) {
      if (agentType === 'opencode') {
        peer({ type: 'text', capability: currentKey, epoch, sessionID: 'ses_feedback',
          messageID: 'msg_feedback', partID: `prt_${nextPart++}`, text });
      } else {
        output('\x1b[H\x1b[2J' + text.replace(/\n/g, '\r\n') + '\r\n');
      }
    },
    rotate() {
      currentKey = otherCapability;
      epoch += 1;
      panel.setProtocolCapability(currentKey);
      if (agentType === 'opencode') bind();
    },
    dispose() {
      panel.clearPendingReplyEmissions();
      panel.openCodeChannel?.dispose();
      if (panel.gridScanTimer) clearTimeout(panel.gridScanTimer);
      if (panel.commanderActivityTimer) clearTimeout(panel.commanderActivityTimer);
      for (const stream of streams) stream.destroy();
      bridge.destroy();
    },
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TerminalPanel authenticated correction feedback across harnesses', () => {
  it.each(allHarnesses)('%s reports a proven malformed header and routes only a fresh corrected counter', (harness) => {
    vi.useFakeTimers();
    const f = fixture(harness);
    try {
      f.authored(missingHeaderDelimiter());
      expect(f.emitted).not.toHaveBeenCalled();
      expect(f.protocolError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        code: 'missing-header-delimiter', capability, sequences: [1], fingerprint: expect.any(String),
      }), 1);
      f.authored(missingHeaderDelimiter());
      f.authored(frame());
      expect(f.emitted).not.toHaveBeenCalled();
      expect(f.protocolError).toHaveBeenCalledOnce();
      f.authored(frame('SEND:opencode:2', 2));
      expect(f.emitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sequence: 2, content: 'Hi' }));
    } finally { f.dispose(); }
  });

  it.each(allHarnesses)('%s permits at most three notices per arm without resetting on success or resize', (harness) => {
    vi.useFakeTimers();
    const f = fixture(harness);
    try {
      for (let sequence = 1; sequence <= 4; sequence++) f.authored(missingHeaderDelimiter(sequence));
      expect(f.protocolError.mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
      f.authored(frame('SEND:opencode:2', 4));
      expect(f.emitted).not.toHaveBeenCalled(); // Suppressed fourth notice still spends the identity.
      f.authored(frame('SEND:opencode:2', 5));
      expect(f.emitted).toHaveBeenCalledOnce();
      f.panel.vterm.resize(100, 20);
      f.panel.setProtocolCapability(capability); // A repeated arm cannot clear history or the limit.
      f.authored(missingHeaderDelimiter(6));
      expect(f.protocolError).toHaveBeenCalledTimes(3);
      f.rotate();
      f.authored(missingHeaderDelimiter(1, otherCapability));
      expect(f.protocolError).toHaveBeenCalledTimes(4);
      expect(f.protocolError.mock.calls[3]).toEqual([expect.objectContaining({
        capability: otherCapability, sequences: [1],
      }), 1]);
    } finally { f.dispose(); }
  });

  it.each(allHarnesses)('%s never feeds back wrong-capability, muted, or reserved prompt-echo output', (harness) => {
    vi.useFakeTimers();
    const f = fixture(harness);
    try {
      f.authored(missingHeaderDelimiter(1, otherCapability));
      f.panel.muteScanner(60000);
      f.authored(missingHeaderDelimiter(2));
      f.panel.unmuteScanner();
      f.panel.reserveProtocolTextForEcho(`Quoted example only:\n${missingHeaderDelimiter(3)}`);
      f.authored(missingHeaderDelimiter(3));
      expect(f.protocolError).not.toHaveBeenCalled();
      expect(f.emitted).not.toHaveBeenCalled();
      f.authored(frame('SEND:opencode:2', 3));
      expect(f.emitted).not.toHaveBeenCalled();
      f.authored(frame('SEND:opencode:2', 4));
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it.each(terminalHarnesses)('%s keeps a mutable unfinished footer inert regardless of delay', (harness) => {
    vi.useFakeTimers();
    const f = fixture(harness);
    try {
      const incomplete = frame().slice(0, -3);
      f.output('\x1b[H\x1b[2J' + incomplete.replace(/\n/g, '\r\n'));
      vi.advanceTimersByTime(120000);
      f.panel.scanGridForProtocol();
      f.panel.scanRenderedTailForReplies();
      expect(f.protocolError).not.toHaveBeenCalled();
      expect(f.emitted).not.toHaveBeenCalled();
      f.output('===\r\n');
      expect(f.protocolError).not.toHaveBeenCalled();
      expect(f.emitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sequence: 1 }));
    } finally { f.dispose(); }
  });

  it.each(terminalHarnesses.flatMap((harness) =>
    ['header', 'both', 'unfinished'].map((shape) => [harness, shape] as const)))('%s reserves %s snapshot identities before unmuting', (harness, shape) => {
    vi.useFakeTimers();
    const f = fixture(harness);
    try {
      const text = shape === 'both' ? missingHeaderDelimiter().slice(0, -3)
        : shape === 'unfinished' ? missingHeaderDelimiter().split('\n').slice(0, -1).join('\n')
        : missingHeaderDelimiter();
      f.panel.vterm.write('\x1b[H\x1b[2J' + text.replace(/\n/g, '\r\n'));
      f.panel.snapshotVisibleProtocolAsProcessed();
      f.authored(missingHeaderDelimiter());
      f.authored(frame());
      expect(f.protocolError).not.toHaveBeenCalled();
      expect(f.emitted).not.toHaveBeenCalled();
      f.authored(frame('SEND:opencode:2', 2));
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it.each(verbs)('all character chunk boundaries preserve valid %s without premature correction', (verb) => {
    vi.useFakeTimers();
    const f = fixture('generic');
    try {
      f.output('\x1b[H\x1b[2J');
      const text = frame(verb).replace(/\n/g, '\r\n') + '\r\n';
      for (const character of text) f.output(character);
      expect(f.protocolError).not.toHaveBeenCalled();
      expect(f.emitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sequence: 1, content: 'Hi' }));
    } finally { f.dispose(); }
  });

  it.each(verbs)('chunked malformed %s waits for its complete authenticated footer before feedback', (verb) => {
    vi.useFakeTimers();
    const f = fixture('generic');
    try {
      f.output('\x1b[H\x1b[2J');
      const text = missingHeaderDelimiter(1, capability, verb).replace(/\n/g, '\r\n');
      for (const character of text.slice(0, -1)) f.output(character);
      expect(f.protocolError).not.toHaveBeenCalled();
      f.output(text.slice(-1));
      expect(f.protocolError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        code: 'missing-header-delimiter', sequences: [1],
      }), 1);
      expect(f.emitted).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });

  it.each(terminalHarnesses)('%s reports both absent delimiters only when the footer becomes immutable scrollback', (harness) => {
    vi.useFakeTimers();
    const f = fixture(harness);
    try {
      const invalid = frame().replaceAll(':1===', ':1');
      f.authored(invalid);
      vi.advanceTimersByTime(120000);
      expect(f.protocolError).not.toHaveBeenCalled();
      f.output('\r\n'.repeat(48));
      expect(f.protocolError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        code: 'missing-both-delimiters', sequences: [1],
      }), 1);
      f.authored(frame());
      expect(f.emitted).not.toHaveBeenCalled();
      f.authored(frame('SEND:opencode:2', 2));
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it('reports a missing footer only after native completed text, without stitching the next part', () => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      const lines = frame().split('\n');
      f.authored(lines.slice(0, -1).join('\n'));
      expect(f.protocolError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        code: 'missing-footer', sequences: [1], capability,
      }), 1);
      f.authored(lines.at(-1)!);
      f.authored(frame());
      expect(f.emitted).not.toHaveBeenCalled();
      f.authored(frame('SEND:opencode:2', 2));
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it('reports an invalid native frame even when the same completed part also has a valid frame', () => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      f.authored(`${frame('BROADCAST', 1)}\n${missingHeaderDelimiter(2)}`);
      expect(f.emitted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'broadcast', sequence: 1 }));
      expect(f.protocolError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        code: 'missing-header-delimiter', sequences: [2],
      }), 1);
      f.authored(frame('SEND:opencode:2', 2));
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it('preserves native issue/event order and never executes a corrected spent ID in the same part', () => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      const observed: string[] = [];
      f.protocolError.mockImplementation((issue) => observed.push(`issue:${issue.sequences[0]}`));
      f.emitted.mockImplementation((message) => observed.push(`event:${message.sequence}`));
      f.authored(`${missingHeaderDelimiter(1)}\n${frame('SEND:opencode:2', 1)}\n${frame('QUERY', 2)}`);
      expect(observed).toEqual(['issue:1', 'event:2']);
    } finally { f.dispose(); }
  });

  it('abandons the rest of a native part when handling its issue rotates the capability', () => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      f.protocolError.mockImplementation(() => f.panel.setProtocolCapability(otherCapability));
      f.authored(`${missingHeaderDelimiter(1)}\n${frame('QUERY', 2)}`);
      expect(f.protocolError).toHaveBeenCalledOnce();
      expect(f.emitted).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });

  it('tracks a human draft independently of controller writes and clears it only on submit or interrupt', () => {
    vi.useFakeTimers();
    const f = fixture('generic');
    try {
      expect(f.panel.userInputGeneration).toBe(0n);
      expect(f.panel.hasPendingUserInput).toBe(false);
      f.panel.recordUserInput('draft');
      expect(f.panel.userInputGeneration).toBe(1n);
      expect(f.panel.hasPendingUserInput).toBe(true);
      f.panel.sendInput('[Commander ACK] delivered\r');
      expect(f.panel.userInputGeneration).toBe(1n);
      expect(f.panel.hasPendingUserInput).toBe(true);
      f.panel.recordUserInput('\r');
      expect(f.panel.hasPendingUserInput).toBe(false);
      f.panel.recordUserInput('new draft');
      f.panel.recordUserInput('\x03');
      expect(f.panel.userInputGeneration).toBe(4n);
      expect(f.panel.hasPendingUserInput).toBe(false);
    } finally { f.dispose(); }
  });
});
