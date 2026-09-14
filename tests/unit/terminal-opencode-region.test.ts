import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const capability = 'a'.repeat(43); // Synthetic public capability, never provider output.
const columns = 213;
const height = 30;

function frame(type = 'REPLY', body = 'Hello Panel 1!', sequence = 1, key = capability) {
  const identity = `${key}:${sequence}`;
  return `===COMMANDER:${type}:${identity}===\n${body}\n===COMMANDER:END:${identity}===`;
}

/** Deterministic OpenCode-shaped ANSI rendering, not an offline/demo agent. */
function draw(text: string, sidebar: boolean, options: {
  chrome?: boolean; width?: number; footerPadding?: 2 | 3;
} = {}) {
  const width = options.width ?? columns;
  const contentWidth = width - (sidebar ? 42 : 0);
  const lines = Array.from({ length: height }, () => '');
  for (const [i, line] of text.split('\n').entries()) lines[10 + i] = `  ${line}`;
  const right = Array.from({ length: height }, () => '');
  if (sidebar) {
    right[1] = '  Agents Commander protocol';
    right[4] = '  Context';
    right[5] = '  9,646 tokens';
    right[9] = '  LSP';
    right[10] = '  LSPs are disabled';
    right[11] = '  Sidebar title on body row';
    right[12] = '  Sidebar text on END row';
    if (options.chrome !== false) right[height - 2] = '  • OpenCode 1.18.30';
  }
  if (options.chrome !== false) {
    lines[height - 2] = 'ctrl+p commands'.padStart(contentWidth - (options.footerPadding ?? 2));
  }
  let ansi = '\x1b[?1049h\x1b[H\x1b[2J';
  for (let y = 0; y < height; y++) {
    ansi += `\x1b[${y + 1};1H\x1b[40m${lines[y].padEnd(contentWidth)}`;
    if (sidebar) ansi += `\x1b[48;5;16m${right[y].padEnd(42)}`;
  }
  return ansi + '\x1b[0m';
}

function fixture() {
  const emitted = vi.fn();
  const protocolError = vi.fn();
  const outputBox = { width: columns + 1, height: height + 1 };
  const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex: 1, agentType: 'opencode', agentName: 'OpenCode (APEX)', cwd: '/synthetic',
    launchSealed: false, _sessionGeneration: 0, _status: 'running',
    _visible: false, box: {}, outputBox,
    vterm: new VTerm(columns, height),
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
    updateHeader: vi.fn(), scheduleRender: vi.fn(), onCommanderMessage: emitted,
    onCommanderProtocolError: protocolError,
  });
  const streams = Array.from({ length: 4 }, () => new PassThrough());
  const outbound: Array<Record<string, unknown>> = [];
  const bridge = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      outbound.push(JSON.parse(chunk.toString('utf8')));
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 123, stdin: streams[0], stdout: streams[1], stderr: streams[2], stdio: [...streams, bridge],
    exitCode: null as number | null, signalCode: null, kill: vi.fn(() => true),
  });
  childProcess.spawn.mockReturnValueOnce(child);
  expect(panel.launchSession('synthetic', [], {}, true, 'internal')).toBe(true);
  panel.setProtocolCapability(capability);
  const token = childProcess.spawn.mock.calls.at(-1)?.[2].env.AGENTS_COMMANDER_OPENCODE_TOKEN;
  const peer = (fields: Record<string, unknown>) => {
    bridge.emit('data', Buffer.from(JSON.stringify({ v: 1, token, ...fields }) + '\n'));
  };
  peer({ type: 'hello' });
  expect(outbound.at(-1)).toMatchObject({ type: 'arm', capability, epoch: 1 });
  peer({ type: 'armed', capability, epoch: 1 });
  peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_fixture' });
  return {
    panel, emitted, protocolError, child, peer,
    complete(text: string, extra: Record<string, unknown> = {}) {
      peer({ type: 'text', capability, epoch: 1, sessionID: 'ses_fixture',
        messageID: 'msg_fixture', partID: 'prt_fixture', text, ...extra });
    },
    output(text: string) { child.stdout.emit('data', Buffer.from(text)); },
    dispose() {
      panel.clearPendingReplyEmissions();
      panel.openCodeChannel?.dispose();
      if (panel.gridScanTimer) clearTimeout(panel.gridScanTimer);
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

describe('TerminalPanel OpenCode semantic routing across sidebar layouts', () => {
  it.each(['SEND:opencode:1', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])(
    'routes exact authored %s content while hidden, independently of a contaminated sidebar viewport', (type) => {
      vi.useFakeTimers();
      const f = fixture();
      try {
        const body = type === 'QUERY' ? 'agents' : 'Hello: only the conversation belongs in this payload.';
        f.output(draw(frame(type, body), true));
        expect(f.panel.isVisible).toBe(false);
        vi.advanceTimersByTime(20000);
        expect(f.emitted).not.toHaveBeenCalled();
        f.complete(frame(type, body));
        expect(f.emitted).toHaveBeenCalledOnce();
        expect(f.emitted.mock.calls[0][0]).toMatchObject({ content: body, capability, sequence: 1 });
        expect(f.panel.getProtocolGridRows()).toEqual([]);
        expect(f.panel.getProtocolTailRows()).toEqual([]);
        expect(f.emitted.mock.calls[0][0].content).not.toContain('Sidebar');
        // No resize/input/later paint is needed to rescue semantic delivery.
        f.output(draw(frame(type, body), false));
        vi.advanceTimersByTime(20000);
        f.complete(frame(type, body));
        expect(f.emitted).toHaveBeenCalledOnce();
        f.output(draw(frame(type, body, 2), false));
        vi.advanceTimersByTime(50);
        expect(f.emitted).toHaveBeenCalledOnce();
        f.complete(frame(type, body, 2));
        expect(f.emitted).toHaveBeenCalledTimes(2);
      } finally { f.dispose(); }
    },
  );

  it('never uses raw grid, rendered tail or scrollback fallback when a native channel is configured', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame(), true));
      f.panel.scanGridForProtocol();
      f.panel.scanRenderedTailForReplies();
      f.output('\x1b[?1049l' + frame('REPLY', 'primary buffer', 2).replaceAll('\n', '\r\n') + '\r\n'.repeat(height * 2));
      f.panel.feedScannerFromVTerm(true);
      vi.advanceTimersByTime(20000);
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(frame());
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it('does not reserve authored semantic identities just because they appeared in a viewport snapshot', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame(), true));
      f.panel.snapshotVisibleProtocolAsProcessed();
      vi.advanceTimersByTime(50);
      expect(f.emitted).not.toHaveBeenCalled();
      f.output(draw(frame(), false));
      vi.advanceTimersByTime(20000);
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(frame());
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0].content).toBe('Hello Panel 1!');
    } finally { f.dispose(); }
  });

  it('preserves prompt echo reservations across visible/sidebar/full-width repaints', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.panel.reserveProtocolTextForEcho(`Example only: ${frame()}`);
      f.panel._visible = true;
      f.output(draw(frame(), true));
      vi.advanceTimersByTime(50);
      f.complete(frame());
      f.output(draw(frame(), false));
      vi.advanceTimersByTime(50);
      f.complete(frame());
      expect(f.emitted).not.toHaveBeenCalled();
      f.output(draw(frame('REPLY', 'authored response', 2), false));
      vi.advanceTimersByTime(50);
      f.complete(frame('REPLY', 'authored response', 2));
      expect(f.emitted.mock.calls[0][0].content).toBe('authored response');
    } finally { f.dispose(); }
  });

  it('routes native completed output during an incomplete or unknown sidebar repaint', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame(), true, { chrome: false }));
      vi.advanceTimersByTime(20000);
      f.panel.scanRenderedTailForReplies();
      expect(f.panel.getProtocolGridRows()).toEqual([]);
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(frame());
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0].content).toBe('Hello Panel 1!');
    } finally { f.dispose(); }
  });

  it.each([false, true])(
    'ignores a body clipped by a fresh narrow overlay and routes exact authored text, stale footer=%s', (staleFooter) => {
      vi.useFakeTimers();
      const f = fixture();
      try {
        const width = 120;
        const body = 'x'.repeat(100);
        f.panel.vterm.resize(width, height);
        if (staleFooter) {
          f.output(draw('', false, { width }));
          vi.advanceTimersByTime(50);
        }
        // The body is at row 12 (1-based). One newly painted overlay row is
        // enough to hide its final 24 characters while the header/END survive.
        const partialOverlay = `\x1b[12;${width - 42 + 1}H\x1b[48;5;16m${' '.repeat(42)}\x1b[0m`;
        f.output(draw(frame('REPLY', body), false, { width, chrome: staleFooter }) + partialOverlay);
        vi.advanceTimersByTime(50);
        f.panel.scanRenderedTailForReplies();
        f.panel.snapshotVisibleProtocolAsProcessed();
        expect(f.panel.getProtocolGridRows()).toEqual([]);
        expect(f.emitted).not.toHaveBeenCalled();
        // No fresh layout is required; the semantic payload is not clipped.
        f.complete(frame('REPLY', body));
        expect(f.emitted).toHaveBeenCalledOnce();
        expect(f.emitted.mock.calls[0][0].content).toBe(body);
      } finally { f.dispose(); }
    },
  );

  it('continues routing after wide-to-narrow resize with the real three-cell idle footer', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame('REPLY', 'first reply'), true));
      vi.advanceTimersByTime(50);
      f.complete(frame('REPLY', 'first reply'));
      expect(f.emitted).toHaveBeenCalledOnce();
      f.panel.vterm.resize(115, height);
      f.panel.scanGridForProtocol();
      f.output(draw(frame('REPLY', 'next reply', 2), false, { width: 115, footerPadding: 3 }));
      vi.advanceTimersByTime(50);
      expect(f.emitted).toHaveBeenCalledOnce();
      f.complete(frame('REPLY', 'next reply', 2));
      expect(f.emitted).toHaveBeenCalledTimes(2);
      expect(f.emitted.mock.calls[1][0].content).toBe('next reply');
      f.output(draw(frame('REPLY', 'first reply'), false, { width: 115, footerPadding: 3 }));
      vi.advanceTimersByTime(50);
      f.complete(frame('REPLY', 'first reply'));
      expect(f.emitted).toHaveBeenCalledTimes(2);
    } finally { f.dispose(); }
  });

  it('keeps capability and END matching strict in native output regardless of the visible conversation', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame('REPLY', 'wrong key', 1, 'b'.repeat(43)), true));
      f.complete(frame('REPLY', 'wrong key', 1, 'b'.repeat(43)));
      vi.advanceTimersByTime(50);
      f.output(draw(frame('REPLY', 'wrong footer', 1).replace(`END:${capability}:1`, `END:${capability}:2`), true));
      f.complete(frame('REPLY', 'wrong footer', 1).replace(`END:${capability}:1`, `END:${capability}:2`));
      vi.advanceTimersByTime(50);
      expect(f.emitted).not.toHaveBeenCalled();
      expect(f.protocolError).toHaveBeenCalledExactlyOnceWith('invalid-frame');
      f.output(draw(frame('REPLY', 'valid', 2), true));
      vi.advanceTimersByTime(50);
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(frame('REPLY', 'valid', 2));
      // Both authenticated counters in the malformed header/footer are spent.
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(frame('REPLY', 'valid', 3));
      expect(f.emitted.mock.calls[0][0].content).toBe('valid');
    } finally { f.dispose(); }
  });

  it('delivers exact multiline text and does not replay it after resize and fresh redraw', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      const body = 'Line one: 界 🚀 café\n  indented line two';
      f.output(draw(frame('REPLY', body), true));
      vi.advanceTimersByTime(50);
      f.complete(frame('REPLY', body));
      // Presentation indentation and right-side chrome are not source text.
      expect(f.emitted.mock.calls[0][0].content).toBe(body);
      f.panel.vterm.resize(110, height);
      f.panel.scanGridForProtocol();
      expect(f.emitted).toHaveBeenCalledOnce();
      f.output(draw(frame('REPLY', body), false, { width: 110 }));
      vi.advanceTimersByTime(50);
      f.complete(frame('REPLY', body));
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it('fails closed after transport loss even if a complete frame is visibly painted', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.peer({ type: 'error', capability, epoch: 1, code: 'transport-failed' });
      expect(f.panel.getProtocolSetupError()).toContain('unavailable');
      f.output(draw(frame(), true));
      f.panel.scanGridForProtocol();
      f.panel.scanRenderedTailForReplies();
      f.panel.snapshotVisibleProtocolAsProcessed();
      f.panel.flushFinalProtocolOutput(f.child);
      vi.advanceTimersByTime(20000);
      f.complete(frame());
      expect(f.emitted).not.toHaveBeenCalled();
      expect(f.panel.openCodeChannel.status).toContain('transport unavailable');
    } finally { f.dispose(); }
  });

  it('ignores native output from another conversation or a replaced terminal process', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.complete(frame(), { sessionID: 'ses_other' });
      expect(f.emitted).not.toHaveBeenCalled();
      f.panel.proc = {};
      f.complete(frame());
      expect(f.emitted).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
});
