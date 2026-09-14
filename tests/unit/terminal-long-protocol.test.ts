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

// Six-panel 351x74 Commander layouts leave approximately this much space per
// child. These are public synthetic fixtures, not a provider session recording.
const width = 114;
const height = 31;
const transcriptRows = 24;
const capability = 'a'.repeat(43);
const longBody = Array.from({ length: 48 }, (_, n) => (
  `line-${String(n + 1).padStart(3, '0')}: preserve the complete payload, including this line.`
)).join('\n');

function frameLines(type: string, body: string, sequence = 1): string[] {
  const identity = `${capability}:${sequence}`;
  return [`===COMMANDER:${type}:${identity}===`, ...body.split('\n'), `===COMMANDER:END:${identity}===`];
}

/** Cursor-addressed, footer-verified OpenCode-shaped viewport redraw. */
function drawViewport(transcript: string[]): string {
  const rows = Array.from({ length: height }, () => '');
  for (const [index, line] of transcript.slice(-transcriptRows).entries()) rows[index + 1] = `  ${line}`;
  rows[height - 2] = 'ctrl+p commands'.padStart(width - 3);
  let ansi = '\x1b[?1049h\x1b[H\x1b[2J';
  for (const [index, row] of rows.entries()) {
    ansi += `\x1b[${index + 1};1H\x1b[40m${row.padEnd(width)}`;
  }
  return ansi + '\x1b[0m';
}

function fixture(agentType: 'opencode' | 'generic') {
  const emitted = vi.fn();
  const protocolError = vi.fn();
  const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex: 0, agentType, agentName: 'Synthetic long-frame agent', cwd: '/synthetic',
    launchSealed: false, _sessionGeneration: 0, _status: 'running',
    _visible: false, box: {}, outputBox: { width: width + 1, height: height + 1 },
    vterm: new VTerm(width, height),
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
    exitCode: null as number | null, signalCode: null, kill: vi.fn(() => true),
  });
  childProcess.spawn.mockReturnValueOnce(child);
  expect(panel.launchSession('synthetic', [], {}, true, 'internal')).toBe(true);
  panel.setProtocolCapability(capability);
  const token = childProcess.spawn.mock.calls.at(-1)?.[2].env.AGENTS_COMMANDER_OPENCODE_TOKEN;
  const peer = (fields: Record<string, unknown>) => {
    bridge.emit('data', Buffer.from(JSON.stringify({ v: 1, token, ...fields }) + '\n'));
  };
  if (agentType === 'opencode') {
    peer({ type: 'hello' });
    expect(outbound.at(-1)).toMatchObject({ type: 'arm', capability, epoch: 1 });
    peer({ type: 'armed', capability, epoch: 1 });
    peer({ type: 'bound', capability, epoch: 1, sessionID: 'ses_fixture' });
  }
  return {
    panel, emitted, protocolError, peer,
    complete(text: string, extra: Record<string, unknown> = {}) {
      peer({ type: 'text', capability, epoch: 1, sessionID: 'ses_fixture',
        messageID: 'msg_fixture', partID: 'prt_fixture', text, ...extra });
    },
    output(ansi: string) {
      child.stdout.emit('data', Buffer.from(ansi));
      vi.advanceTimersByTime(50);
    },
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

describe('TerminalPanel payloads taller than a six-panel viewport', () => {
  it.each(['SEND:opencode:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])(
    'routes short OpenCode %s only from the completed semantic part, not the viewport', (type) => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      const lines = frameLines(type, 'short control');
      f.output(drawViewport(lines));
      f.panel.scanGridForProtocol();
      f.panel.scanRenderedTailForReplies();
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(lines.join('\n'));
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0]).toMatchObject({ content: 'short control', sequence: 1 });
    } finally { f.dispose(); }
  });

  it.each(['SEND:opencode:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])(
    'routes exact long normal-buffer %s while its footer remains on screen', (type) => {
      vi.useFakeTimers();
      const f = fixture('generic');
      try {
        f.output(frameLines(type, longBody).join('\r\n') + '\r\n');
        expect(f.panel.vterm.inAltScreen).toBe(false);
        expect(f.panel.vterm.primaryScrollbackEndIndex).toBeGreaterThan(0);
        expect(f.panel.vterm.getGridPlainLines().join('\n')).toContain('===COMMANDER:END:');
        expect(f.emitted).toHaveBeenCalledOnce();
        expect(f.emitted.mock.calls[0][0]).toMatchObject({ content: longBody, sequence: 1 });
        f.output('\r\n'.repeat(height * 2));
        vi.advanceTimersByTime(20000);
        expect(f.emitted).toHaveBeenCalledOnce();
      } finally { f.dispose(); }
    },
  );

  it.each(['SEND:opencode:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])(
    'routes exact long OpenCode %s whose authenticated header scrolls out before END appears', (type) => {
      vi.useFakeTimers();
      const f = fixture('opencode');
      try {
        const lines = frameLines(type, longBody);
        for (let visible = 1; visible <= lines.length; visible++) {
          f.output(drawViewport(lines.slice(0, visible)));
          expect(f.emitted).not.toHaveBeenCalled();
        }
        // Every line was observed in order, with overlapping intact projected
        // views, but no individual visible grid contains both boundary markers.
        expect(f.panel.vterm.inAltScreen).toBe(true);
        expect(f.panel.vterm.primaryScrollbackEndIndex).toBe(0);
        expect(f.panel.vterm.getGridPlainRows().map((row: { text: string }) => row.text).join('\n'))
          .not.toContain(`===COMMANDER:${type}:`);
        expect(f.panel.isVisible).toBe(false);
        f.complete(lines.join('\n'));
        expect(f.emitted).toHaveBeenCalledOnce();
        expect(f.emitted.mock.calls[0][0]).toMatchObject({ content: longBody, sequence: 1 });
        f.panel.vterm.resize(210, 35);
        f.output(drawViewport(lines));
        f.complete(lines.join('\n'), { partID: 'prt_redraw' });
        expect(f.emitted).toHaveBeenCalledOnce();
        f.complete(frameLines(type, longBody, 2).join('\n'));
        expect(f.emitted).toHaveBeenCalledTimes(2);
      } finally { f.dispose(); }
    },
  );

  it('reports an incomplete completed part once, never stitches across parts, and accepts a fresh valid frame', () => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      const lines = frameLines('BROADCAST', longBody);
      const partial = lines.slice(0, -1).join('\n');
      f.complete(partial);
      f.complete(partial, { partID: 'prt_repeated' });
      expect(f.protocolError).toHaveBeenCalledExactlyOnceWith('invalid-frame');
      expect(f.panel.nativeProtocolIssue).toBe('invalid frame — not sent');
      f.complete(lines.at(-1)!);
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(lines.join('\n')); // A corrected rejected identity is still spent.
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(frameLines('BROADCAST', longBody, 2).join('\n'));
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0]).toMatchObject({ sequence: 2, content: longBody });
      expect(f.panel.nativeProtocolIssue).toBeNull();
    } finally { f.dispose(); }
  });

  it('preserves prompt-echo reservations and rejected-action sequence dedup on the semantic channel', () => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      const quoted = frameLines('BROADCAST', 'example').join('\n');
      f.panel.reserveProtocolTextForEcho(`Example only: ${quoted}`);
      f.complete(quoted);
      expect(f.emitted).not.toHaveBeenCalled();
      f.complete(frameLines('SEND:apex:2', 'wrong adapter', 2).join('\n'));
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0]).toMatchObject({ rejection: 'unknown_agent_type', sequence: 2 });
      f.complete(frameLines('SEND:opencode:2', 'corrected reused ID', 2).join('\n'));
      expect(f.emitted).toHaveBeenCalledOnce();
      f.complete(frameLines('SEND:opencode:2', 'fresh ID', 3).join('\n'));
      expect(f.emitted).toHaveBeenCalledTimes(2);
    } finally { f.dispose(); }
  });

  it('rejects wrong capability/footer and never promotes a nested frame without viewport fallback', () => {
    vi.useFakeTimers();
    const f = fixture('opencode');
    try {
      const good = frameLines('REPLY', 'fresh').join('\n');
      f.complete(good.replaceAll(capability, 'b'.repeat(43)));
      expect(f.protocolError).not.toHaveBeenCalled();
      f.complete(good.replace(`END:${capability}:1`, `END:${capability}:2`));
      expect(f.protocolError).toHaveBeenCalledOnce();
      expect(f.emitted).not.toHaveBeenCalled();
      const nested = frameLines('BROADCAST', frameLines('REPLY', 'inner', 11).join('\n'), 10).join('\n');
      f.complete(nested);
      expect(f.emitted.mock.calls.every(([event]) => event.type !== 'reply' && event.sequence !== 11)).toBe(true);
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0]).toMatchObject({ type: 'broadcast', sequence: 10 });
    } finally { f.dispose(); }
  });
});
