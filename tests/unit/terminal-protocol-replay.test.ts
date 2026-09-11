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

// Public synthetic capability: never read credentials or captured model output.
const capability = 'a'.repeat(43);
const clearViewport = '\x1b[H\x1b[2J';

function frame(
  type = 'SEND:generic:2',
  body = 'Review the public example.',
  key = capability,
  sequence?: number,
) {
  const terminalBody = body.replace(/\r?\n/g, '\r\n');
  const identity = sequence === undefined ? key : `${key}:${sequence}`;
  return `===COMMANDER:${type}:${identity}===\r\n${terminalBody}\r\n===COMMANDER:END:${identity}===\r\n`;
}

function createFixture() {
  const allStreams: PassThrough[] = [];
  const emitted = vi.fn();
  const outputBox = { width: 101, height: 31 };
  const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex: 0, agentName: 'Synthetic Replay Agent', cwd: '/synthetic',
    launchSealed: false, _sessionGeneration: 0, _status: 'running',
    _visible: false, box: {}, outputBox,
    vterm: new VTerm(100, 30),
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
    onCommanderMessage: emitted,
  });

  function launch() {
    const streams = Array.from({ length: 4 }, () => new PassThrough());
    allStreams.push(...streams);
    const child = Object.assign(new EventEmitter(), {
      pid: 123 + panel.sessionGeneration,
      stdin: streams[0], stdout: streams[1], stderr: streams[2], stdio: streams,
      exitCode: null as number | null, signalCode: null,
      kill: vi.fn(() => true),
    });
    childProcess.spawn.mockReturnValueOnce(child);
    expect(panel.launchSession('synthetic', [], {}, true, 'internal')).toBe(true);
    return child;
  }

  return {
    panel, emitted, outputBox, launch,
    render(child: ReturnType<typeof launch>, text: string) {
      child.stdout.emit('data', Buffer.from(clearViewport + text));
      vi.advanceTimersByTime(50);
    },
    dispose() {
      panel.clearPendingReplyEmissions();
      if (panel.gridScanTimer) clearTimeout(panel.gridScanTimer);
      for (const stream of allStreams) stream.destroy();
    },
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TerminalPanel session-scoped protocol replay protection', () => {
  it('detects a complete Claude-style redraw on the first scheduled scan without further output', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      fixture.panel.setProtocolCapability(capability);
      child.stdout.emit('data', Buffer.from(clearViewport + 'x'.repeat(100) + 'old continuation'));
      vi.advanceTimersByTime(50);
      expect(fixture.emitted).not.toHaveBeenCalled();

      const body = 'Synthetic prompt-delivery latency check.';
      const redraw = `\x1b[2;1H\x1b[2K●${frame('SEND:codex:2', body, capability, 1)}`;
      const start = Date.now();
      child.stdout.emit('data', Buffer.from(redraw));
      // No scrolling, resize, input or later repaint is supplied to rescue it.
      vi.advanceTimersByTime(49);
      expect(fixture.emitted).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(Date.now() - start).toBe(50);
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0]).toMatchObject({
        type: 'send', targetAgent: 'codex', targetPanel: 1, content: body, sequence: 1,
      });
      fixture.render(child, redraw);
      vi.advanceTimersByTime(2000);
      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('rotates away from partial old output and ignores stale headers before a long current frame', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      fixture.panel.setProtocolCapability(capability);
      const partial = `===COMMANDER:SEND:generic:2:${capability}:1===\r\nunfinished\r\n`;
      child.stdout.emit('data', Buffer.from(partial + '\r\n'.repeat(35)));
      const next = 'b'.repeat(43);
      fixture.panel.setProtocolCapability(next);
      const content = Array.from({ length: 40 }, (_, i) => `new line ${i}`).join('\n');
      child.stdout.emit('data', Buffer.from(clearViewport + partial + frame('SEND:generic:2', content, next, 1) + '\r\n'.repeat(35)));
      vi.advanceTimersByTime(500);
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0]).toMatchObject({ capability: next, sequence: 1, content });
      // Binding the same key again must never reset its replay ledger.
      fixture.panel.setProtocolCapability(next);
      fixture.render(child, frame('SEND:generic:2', content, next, 1));
      fixture.render(child, frame('SEND:generic:2', 'stale command', capability, 2));
      vi.advanceTimersByTime(500);
      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('shows a persistent fail-closed warning at legacy capacity and recovers only on explicit new capability', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      fixture.launch();
      fixture.panel.setProtocolCapability(capability);
      for (let i = 0; i <= 4096; i++) fixture.panel.emitDeduped({ type: 'status', sourcePanel: 0,
        sourceAgent: 'Synthetic', targetAgent: 'generic', targetPanel: -1, content: `status ${i}`, capability }, 'grid');
      expect(fixture.emitted).toHaveBeenCalledTimes(4096);
      expect(fixture.panel.protocolReplayWarningShown).toBe(true);
      fixture.panel.setProtocolCapability(capability);
      expect(fixture.panel.protocolReplayWarningShown).toBe(true);
      const next = 'b'.repeat(43);
      fixture.panel.setProtocolCapability(next);
      expect(fixture.panel.protocolReplayWarningShown).toBe(false);
      fixture.panel.emitDeduped({ type: 'status', sourcePanel: 0, sourceAgent: 'Synthetic',
        targetAgent: 'generic', targetPanel: -1, content: 'new status', capability: next, sequence: 1 }, 'grid');
      expect(fixture.emitted).toHaveBeenCalledTimes(4097);
    } finally { fixture.dispose(); }
  });

  it.each(['SEND:generic:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY'])(
    'does not emit an old %s again when TUI history reappears after the dedup window',
    (type) => {
      vi.useFakeTimers();
      const fixture = createFixture();
      try {
        const child = fixture.launch();
        child.stdout.emit('data', Buffer.from('\x1b[?1049h'));
        fixture.render(child, frame(type));
        expect(fixture.emitted).toHaveBeenCalledOnce();

        // Agent TUI scrolls history out of view. No output is authored while it
        // is offscreen; a later full repaint brings the same history back.
        fixture.render(child, 'Current prompt only');
        vi.advanceTimersByTime(16000);
        fixture.render(child, frame(type));
        fixture.render(child, frame(type));

        expect(fixture.emitted).toHaveBeenCalledOnce();
      } finally { fixture.dispose(); }
    },
  );

  it('does not replay a prior SEND after PTY resize changes soft wrapping', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const content = 'Review strict panel counts from 1 to 100. Reject zero, fractions and values above the limit; preserve a valid count unchanged.';
    try {
      const child = fixture.launch();
      child.stdout.emit('data', Buffer.from('\x1b[?1049h'));
      fixture.render(child, frame('SEND:generic:2', content));
      expect(fixture.emitted.mock.calls[0][0].content).toBe(content);
      fixture.render(child, 'Current prompt only');
      vi.advanceTimersByTime(16000);

      fixture.outputBox.width = 49;
      fixture.outputBox.height = 15;
      fixture.panel.resize({ top: 0, left: 0, width: 50, height: 16 });
      fixture.render(child, frame('SEND:generic:2', content));

      expect(fixture.panel.vterm.colCount).toBe(48);
      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('does not replay a visible command when it enters scrollback much later', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      fixture.render(child, frame());
      expect(fixture.emitted).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(16000);
      child.stdout.emit('data', Buffer.from('Ordinary output\r\n'.repeat(160)));
      vi.advanceTimersByTime(500);

      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('keeps distinct authored bodies and significant indentation routable', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const bodies = [
      'if ready:\n  approve()',
      'if ready:\napprove()',
      'Review result revision 2.',
    ];
    try {
      const child = fixture.launch();
      for (const body of bodies) {
        fixture.render(child, frame('SEND:generic:2', body));
        fixture.render(child, 'Current prompt only');
      }
      expect(fixture.emitted.mock.calls.map(([message]) => message.content)).toEqual(bodies);
    } finally { fixture.dispose(); }
  });

  it('keeps destination and capability identity separate', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      fixture.render(child, frame());
      fixture.render(child, frame('SEND:generic:3'));
      fixture.render(child, frame('SEND:generic:2', 'Review the public example.', 'b'.repeat(43)));
      expect(fixture.emitted).toHaveBeenCalledTimes(3);
      expect(fixture.emitted.mock.calls.map(([message]) => message.targetPanel)).toEqual([1, 2, 1]);
      expect(fixture.emitted.mock.calls.map(([message]) => message.capability)).toEqual([
        capability, capability, 'b'.repeat(43),
      ]);
    } finally { fixture.dispose(); }
  });

  it('uses the sequence identity when a TUI hard-wraps the same frame differently', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const content = 'Review strict panel counts from 1 to 100 and report invalid input.';
    try {
      const child = fixture.launch();
      child.stdout.emit('data', Buffer.from('\x1b[?1049h'));
      fixture.render(child, frame('SEND:generic:2', content, capability, 1));
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0]).toMatchObject({ sequence: 1, content });

      fixture.render(child, 'Current prompt only');
      vi.advanceTimersByTime(16000);
      fixture.outputBox.width = 49;
      fixture.outputBox.height = 15;
      fixture.panel.resize({ top: 0, left: 0, width: 50, height: 16 });
      fixture.render(child, frame('SEND:generic:2',
        'Review strict panel counts from 1 to 100\nand report invalid input.', capability, 1));
      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('routes intentionally identical new output with a fresh sequence', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      fixture.render(child, frame('SEND:generic:2', 'Repeat this action.', capability, 1));
      fixture.render(child, frame('SEND:generic:2', 'Repeat this action.', capability, 2));
      expect(fixture.emitted).toHaveBeenCalledTimes(2);
      expect(fixture.emitted.mock.calls.map(([message]) => message.sequence)).toEqual([1, 2]);
    } finally { fixture.dispose(); }
  });

  it('does not promote repeated outgoing prompt echoes into authored sequenced messages', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      const prompt = frame('REPLY', 'Review complete.', capability, 1);
      fixture.panel.reserveProtocolTextForEcho(prompt);
      for (let index = 0; index < 5; index += 1) {
        fixture.render(child, prompt);
        fixture.render(child, 'Current prompt only');
        vi.advanceTimersByTime(16000);
      }
      expect(fixture.emitted).not.toHaveBeenCalled();
      fixture.render(child, frame('REPLY', 'Review complete.', capability, 2));
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0].sequence).toBe(2);
    } finally { fixture.dispose(); }
  });

  it('does not accept a reused sequence with a changed destination or body', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      fixture.render(child, frame('SEND:generic:2', 'First action.', capability, 1));
      fixture.render(child, 'Current prompt only');
      vi.advanceTimersByTime(16000);
      fixture.render(child, frame('SEND:generic:3', 'Reused sequence.', capability, 1));
      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('accepts an unseen out-of-order sequence inside the replay window only once', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      for (const sequence of [2, 1, 2, 1]) {
        fixture.render(child, frame('SEND:generic:2', `Message ${sequence}.`, capability, sequence));
        fixture.render(child, 'Current prompt only');
      }
      expect(fixture.emitted.mock.calls.map(([message]) => message.sequence)).toEqual([2, 1]);
    } finally { fixture.dispose(); }
  });

  it('fails closed for old sequence numbers below the bounded replay window', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      for (const sequence of [10, Number.MAX_SAFE_INTEGER, 2, 10]) {
        fixture.render(child, frame('SEND:generic:2', `Message ${sequence}.`, capability, sequence));
        fixture.render(child, 'Current prompt only');
      }
      expect(fixture.emitted.mock.calls.map(([message]) => message.sequence)).toEqual([
        10, Number.MAX_SAFE_INTEGER,
      ]);
    } finally { fixture.dispose(); }
  });

  it('keeps premarked legacy instruction echoes suppressed after the old reservation timeout', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const child = fixture.launch();
      const instructions = frame('SEND:generic:2', 'Synthetic example from injected instructions.');
      fixture.panel.markProtocolTextAsProcessed(instructions);
      fixture.render(child, instructions);
      fixture.render(child, 'Current prompt only');
      vi.advanceTimersByTime(61000);
      fixture.render(child, instructions);
      expect(fixture.emitted).not.toHaveBeenCalled();
    } finally { fixture.dispose(); }
  });

  it.each([undefined, 1])('resets replay history on actual session relaunch and ignores old-process repaint (sequence: %s)', (sequence) => {
    vi.useFakeTimers();
    const fixture = createFixture();
    try {
      const oldChild = fixture.launch();
      fixture.render(oldChild, frame('SEND:generic:2', 'Review the public example.', capability, sequence));
      oldChild.exitCode = 0;
      oldChild.emit('close', 0, null);

      fixture.panel.vterm = new VTerm(100, 30);
      const newChild = fixture.launch();
      expect(fixture.panel.sessionGeneration).toBe(2);
      fixture.render(oldChild, frame('SEND:generic:3', 'Stale process output'));
      fixture.render(newChild, frame('SEND:generic:2', 'Review the public example.', capability, sequence));

      expect(fixture.emitted).toHaveBeenCalledTimes(2);
      expect(fixture.emitted.mock.calls.map(([message]) => message.content)).toEqual([
        'Review the public example.', 'Review the public example.',
      ]);
    } finally { fixture.dispose(); }
  });
});
