import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
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
}));

const capability = 'a'.repeat(43); // Synthetic public capability, never provider output.
const columns = 213;
const height = 30;

function frame(type = 'REPLY', body = 'Hello Panel 1!', sequence = 1, key = capability) {
  const identity = `${key}:${sequence}`;
  return `===COMMANDER:${type}:${identity}===\n${body}\n===COMMANDER:END:${identity}===`;
}

/** Deterministic OpenCode-shaped ANSI rendering, not an offline/demo agent. */
function draw(text: string, sidebar: boolean, options: { chrome?: boolean; width?: number } = {}) {
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
    lines[height - 2] = 'ctrl+p commands'.padStart(contentWidth - 2);
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
  });
  const streams = Array.from({ length: 4 }, () => new PassThrough());
  const child = Object.assign(new EventEmitter(), {
    pid: 123, stdin: streams[0], stdout: streams[1], stderr: streams[2], stdio: streams,
    exitCode: null as number | null, signalCode: null, kill: vi.fn(() => true),
  });
  childProcess.spawn.mockReturnValueOnce(child);
  expect(panel.launchSession('synthetic', [], {}, true, 'internal')).toBe(true);
  panel.setProtocolCapability(capability);
  return {
    panel, emitted, child,
    output(text: string) { child.stdout.emit('data', Buffer.from(text)); },
    dispose() {
      panel.clearPendingReplyEmissions();
      if (panel.gridScanTimer) clearTimeout(panel.gridScanTimer);
      for (const stream of streams) stream.destroy();
    },
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TerminalPanel OpenCode sidebar routing integration', () => {
  it.each(['SEND:opencode:1', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])(
    'routes exact %s content in the first scan, with a hidden Commander panel', (type) => {
      vi.useFakeTimers();
      const f = fixture();
      try {
        const body = type === 'QUERY' ? 'agents' : 'Hello: only the conversation belongs in this payload.';
        f.output(draw(frame(type, body), true));
        expect(f.panel.isVisible).toBe(false);
        vi.advanceTimersByTime(49);
        expect(f.emitted).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(f.emitted).toHaveBeenCalledOnce();
        expect(f.emitted.mock.calls[0][0]).toMatchObject({ content: body, capability, sequence: 1 });
        expect(f.panel.getProtocolGridRows()).toEqual(f.panel.getProtocolTailRows());
        expect(f.panel.getProtocolGridRows().map((row: { text: string }) => row.text).join('\n'))
          .not.toContain('Sidebar');
        // No resize/input/later paint was supplied to rescue initial delivery.
        f.output(draw(frame(type, body), false));
        vi.advanceTimersByTime(20000);
        expect(f.emitted).toHaveBeenCalledOnce();
        f.output(draw(frame(type, body, 2), false));
        vi.advanceTimersByTime(50);
        expect(f.emitted).toHaveBeenCalledTimes(2);
      } finally { f.dispose(); }
    },
  );

  it('uses the same verified projection for the REPLY tail fallback', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame(), true));
      f.panel.scanRenderedTailForReplies();
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0].content).toBe('Hello Panel 1!');
      vi.advanceTimersByTime(50);
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it('snapshots projected examples before paint and suppresses them after sidebar toggles', () => {
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
      f.output(draw(frame('REPLY', 'fresh response', 2), true));
      vi.advanceTimersByTime(50);
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0].content).toBe('fresh response');
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
      f.output(draw(frame(), false));
      vi.advanceTimersByTime(50);
      expect(f.emitted).not.toHaveBeenCalled();
      f.output(draw(frame('REPLY', 'authored response', 2), false));
      vi.advanceTimersByTime(50);
      expect(f.emitted.mock.calls[0][0].content).toBe('authored response');
    } finally { f.dispose(); }
  });

  it('does not use raw grid or tail fallback during an incomplete sidebar repaint', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame(), true, { chrome: false }));
      vi.advanceTimersByTime(20000);
      f.panel.scanRenderedTailForReplies();
      expect(f.panel.getProtocolGridRows()).toEqual([]);
      expect(f.emitted).not.toHaveBeenCalled();
      f.output(draw(frame(), true));
      vi.advanceTimersByTime(50);
      expect(f.emitted).toHaveBeenCalledOnce();
      expect(f.emitted.mock.calls[0][0].content).toBe('Hello Panel 1!');
    } finally { f.dispose(); }
  });

  it('keeps capability and END matching strict inside the projected conversation', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.output(draw(frame('REPLY', 'wrong key', 1, 'b'.repeat(43)), true));
      vi.advanceTimersByTime(50);
      f.output(draw(frame('REPLY', 'wrong footer', 1).replace(`END:${capability}:1`, `END:${capability}:2`), true));
      vi.advanceTimersByTime(50);
      expect(f.emitted).not.toHaveBeenCalled();
      f.output(draw(frame('REPLY', 'valid', 1), true));
      vi.advanceTimersByTime(50);
      expect(f.emitted.mock.calls[0][0].content).toBe('valid');
    } finally { f.dispose(); }
  });

  it('delivers exact multiline text and does not replay it after resize and fresh redraw', () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      const body = 'Line one\n  indented line two';
      f.output(draw(frame('REPLY', body), true));
      vi.advanceTimersByTime(50);
      expect(f.emitted.mock.calls[0][0].content).toBe('Line one\n    indented line two');
      // OpenCode's presentation indentation is already part of existing scanner
      // semantics; this test ensures right-hand chrome adds no further content.
      f.panel.vterm.resize(110, height);
      f.panel.scanGridForProtocol();
      expect(f.emitted).toHaveBeenCalledOnce();
      f.output(draw(frame('REPLY', body), false, { width: 110 }));
      vi.advanceTimersByTime(50);
      expect(f.emitted).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
});
