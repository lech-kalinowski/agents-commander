import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtocolScanner } from '../../src/orchestration/protocol.js';
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

// Synthetic public capabilities; never use credentials or captured model output.
const capability = 'a'.repeat(43);
const otherCapability = 'b'.repeat(43);
const clearViewport = '\x1b[H\x1b[2J';

function frame(agent = 'apex', body = 'hi', sequence: number | null = 1, key = capability) {
  const identity = sequence === null ? key : `${key}:${sequence}`;
  return `===COMMANDER:SEND:${agent}:2:${identity}===\r\n`
    + `${body.replace(/\r?\n/g, '\r\n')}\r\n`
    + `===COMMANDER:END:${identity}===\r\n`;
}

function scannerFixture(options: { maxContentLines?: number; maxContentBytes?: number } = {}) {
  const accepted = vi.fn();
  const rejected = vi.fn();
  const scanner = new ProtocolScanner(0, 'Synthetic Agent', accepted, {
    ...options,
    onRejected: rejected,
  });
  return { scanner, accepted, rejected };
}

function terminalFixture() {
  const allStreams: PassThrough[] = [];
  const emitted = vi.fn();
  const outputBox = { width: 101, height: 31 };
  const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex: 0, agentName: 'Synthetic Rejection Agent', cwd: '/synthetic',
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

  const streams = Array.from({ length: 4 }, () => new PassThrough());
  allStreams.push(...streams);
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    stdin: streams[0], stdout: streams[1], stderr: streams[2], stdio: streams,
    exitCode: null as number | null, signalCode: null,
    kill: vi.fn(() => true),
  });
  childProcess.spawn.mockReturnValueOnce(child);
  expect(panel.launchSession('synthetic', [], {}, true, 'internal')).toBe(true);

  return {
    panel, child, emitted, outputBox,
    render(text: string) {
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

describe('ProtocolScanner authenticated unknown-adapter rejection', () => {
  it('rejects apex:2 explicitly while accepting the actual opencode:2 address', () => {
    const { scanner, accepted, rejected } = scannerFixture();
    scanner.setProtocolCapability(capability);
    scanner.feed(frame('apex'));
    scanner.feed(frame('opencode', 'hi', 2));

    expect(rejected).toHaveBeenCalledExactlyOnceWith({
      type: 'send', sourcePanel: 0, sourceAgent: 'Synthetic Agent',
      targetAgent: 'apex', targetPanel: 1, content: 'hi', capability,
      sequence: 1, rejection: 'unknown_agent_type',
    });
    expect(accepted).toHaveBeenCalledExactlyOnceWith({
      type: 'send', sourcePanel: 0, sourceAgent: 'Synthetic Agent',
      targetAgent: 'opencode', targetPanel: 1, content: 'hi', capability, sequence: 2,
    });
  });

  it('keeps the existing accepted-message callback closed to unknown adapter types', () => {
    const accepted = vi.fn();
    const scanner = new ProtocolScanner(0, 'Synthetic Agent', accepted);
    scanner.setProtocolCapability(capability);
    scanner.feed(frame());
    expect(accepted).not.toHaveBeenCalled();
  });

  it('waits for a complete matching footer across arbitrary PTY chunks', () => {
    const { scanner, accepted, rejected } = scannerFixture();
    scanner.setProtocolCapability(capability);
    const text = frame();
    for (const character of text.slice(0, -1)) scanner.feed(character);
    expect(rejected).not.toHaveBeenCalled();
    scanner.feed('\n');
    expect(rejected).toHaveBeenCalledOnce();
    expect(accepted).not.toHaveBeenCalled();
  });

  it.each([
    ['unarmed capability', frame(), undefined],
    ['wrong capability', frame('apex', 'hi', 1, otherCapability), capability],
    ['unarmed legacy marker', '===COMMANDER:SEND:apex:2===\nhi\n===COMMANDER:END===\n', undefined],
    ['legacy marker on armed session', '===COMMANDER:SEND:apex:2===\nhi\n===COMMANDER:END===\n', capability],
    ['incomplete frame', `===COMMANDER:SEND:apex:2:${capability}:1===\nhi\n`, capability],
    ['mismatched footer capability', frame().replace(`END:${capability}:1`, `END:${otherCapability}:1`), capability],
    ['mismatched footer sequence', frame().replace(`END:${capability}:1`, `END:${capability}:2`), capability],
    ['oversized adapter token', frame('x'.repeat(33)), capability],
    ['malformed adapter token', frame('apex-provider'), capability],
    ['invalid destination panel', frame().replace('SEND:apex:2:', 'SEND:apex:0:'), capability],
    ['noncanonical sequence', frame().replaceAll(`${capability}:1`, `${capability}:01`), capability],
  ])('leaves %s inert', (_name, text, armedCapability) => {
    const { scanner, accepted, rejected } = scannerFixture();
    if (armedCapability) scanner.setProtocolCapability(armedCapability);
    scanner.feed(text!);
    expect(accepted).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
  });

  it('accepts the maximum bounded unknown token as rejection metadata only', () => {
    const { scanner, accepted, rejected } = scannerFixture();
    scanner.setProtocolCapability(capability);
    scanner.feed(frame('x'.repeat(32)));
    expect(accepted).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
      targetAgent: 'x'.repeat(32), rejection: 'unknown_agent_type',
    }));
  });

  it.each([
    [{ maxContentLines: 1 }, 'first\nsecond'],
    [{ maxContentBytes: 8 }, '🙂🙂🙂'],
  ])('applies normal frame budgets before rejection: %j', (options, body) => {
    const { scanner, accepted, rejected } = scannerFixture(options);
    scanner.setProtocolCapability(capability);
    scanner.feed(frame('apex', body));
    expect(accepted).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    scanner.feed(frame('opencode', 'ok', 2));
    expect(accepted).toHaveBeenCalledOnce();
  });

  it('discards a partial rejected frame on capability rotation', () => {
    const { scanner, accepted, rejected } = scannerFixture();
    scanner.setProtocolCapability(capability);
    scanner.feed(`===COMMANDER:SEND:apex:2:${capability}:1===\nold body\n`);
    scanner.setProtocolCapability(otherCapability);
    scanner.feed(`===COMMANDER:END:${capability}:1===\n`);
    scanner.feed(frame('opencode', 'current body', 1, otherCapability));
    expect(rejected).not.toHaveBeenCalled();
    expect(accepted).toHaveBeenCalledWith(expect.objectContaining({ content: 'current body' }));
  });
});

describe('TerminalPanel rejection replay and echo protection', () => {
  it.each(['raw-first', 'grid-first'])('shares one identity across raw and rendered scans (%s)', (order) => {
    vi.useFakeTimers();
    const fixture = terminalFixture();
    try {
      fixture.panel.setProtocolCapability(capability);
      if (order === 'raw-first') fixture.panel.scanner.feed(frame());
      fixture.render(frame());
      fixture.panel.scanner.feed(frame());
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0]).toMatchObject({
        targetAgent: 'apex', targetPanel: 1, sequence: 1, rejection: 'unknown_agent_type',
      });
    } finally { fixture.dispose(); }
  });

  it('does not resend rejection when old output is redrawn, resized, or enters scrollback', () => {
    vi.useFakeTimers();
    const fixture = terminalFixture();
    try {
      fixture.panel.setProtocolCapability(capability);
      fixture.render(frame());
      expect(fixture.emitted).toHaveBeenCalledOnce();
      fixture.render('Current prompt only');
      vi.advanceTimersByTime(16000);
      fixture.outputBox.width = 49;
      fixture.outputBox.height = 15;
      fixture.panel.resize({ top: 0, left: 0, width: 50, height: 16 });
      fixture.render(frame());
      fixture.render(frame());
      fixture.child.stdout.emit('data', Buffer.from('Ordinary output\r\n'.repeat(160)));
      vi.advanceTimersByTime(500);
      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('requires a fresh sequence when correcting apex to opencode', () => {
    vi.useFakeTimers();
    const fixture = terminalFixture();
    try {
      fixture.panel.setProtocolCapability(capability);
      fixture.render(frame('apex', 'hi', 1));
      fixture.render(frame('opencode', 'hi', 1));
      expect(fixture.emitted).toHaveBeenCalledOnce();
      fixture.render(frame('opencode', 'hi', 2));
      expect(fixture.emitted).toHaveBeenCalledTimes(2);
      expect(fixture.emitted.mock.calls[1][0]).toMatchObject({
        targetAgent: 'opencode', targetPanel: 1, content: 'hi', sequence: 2,
      });
      expect(fixture.emitted.mock.calls[1][0]).not.toHaveProperty('rejection');
    } finally { fixture.dispose(); }
  });

  it('deduplicates capability-bound legacy rejections for the whole session', () => {
    vi.useFakeTimers();
    const fixture = terminalFixture();
    try {
      fixture.panel.setProtocolCapability(capability);
      const legacy = frame('apex', 'hi', null);
      fixture.render(legacy);
      fixture.panel.scanner.feed(legacy);
      fixture.render('Current prompt only');
      vi.advanceTimersByTime(61000);
      fixture.render(legacy);
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0]).not.toHaveProperty('sequence');
      fixture.render(frame('apex', 'different authored request', null));
      expect(fixture.emitted).toHaveBeenCalledTimes(2);
    } finally { fixture.dispose(); }
  });

  it.each([
    ['incomplete frame', `===COMMANDER:SEND:apex:2:${capability}:1===\nhi\n`, {}],
    ['wrong footer', frame().replace(`END:${capability}:1`, `END:${capability}:2`), {}],
    ['oversized token', frame('x'.repeat(33)), {}],
    ['invalid destination', frame().replace('SEND:apex:2:', 'SEND:apex:0:'), {}],
    ['line budget overflow', frame('apex', 'first\nsecond'), { maxContentLines: 1 }],
    ['byte budget overflow', frame('apex', '🙂🙂🙂'), { maxContentBytes: 8 }],
  ])('leaves rendered %s inert', (_name, text, options) => {
    vi.useFakeTimers();
    const fixture = terminalFixture();
    try {
      fixture.panel.setProtocolCapability(capability);
      Object.assign(fixture.panel.orchConfig, options);
      // Keep the entire fixture on the grid so this exercises the grid gate,
      // not only the independently covered streaming scanner budget.
      fixture.render(text);
      expect(fixture.emitted).not.toHaveBeenCalled();
    } finally { fixture.dispose(); }
  });

  it.each(['markProtocolTextAsProcessed', 'reserveProtocolTextForEcho'])(
    'does not treat an unknown-adapter example as new output after %s', (method) => {
      vi.useFakeTimers();
      const fixture = terminalFixture();
      try {
        fixture.panel.setProtocolCapability(capability);
        fixture.panel[method](frame());
        fixture.panel.scanner.feed(frame());
        fixture.render(frame());
        fixture.render('Current prompt only');
        vi.advanceTimersByTime(61000);
        fixture.render(frame());
        expect(fixture.emitted).not.toHaveBeenCalled();
        fixture.render(frame('opencode', 'hi', 2));
        expect(fixture.emitted).toHaveBeenCalledOnce();
      } finally { fixture.dispose(); }
    },
  );

  it('snapshots a visible unknown-adapter example without triggering rejection later', () => {
    vi.useFakeTimers();
    const fixture = terminalFixture();
    try {
      fixture.panel.setProtocolCapability(capability);
      fixture.panel.vterm.write(frame());
      fixture.panel.snapshotVisibleProtocolAsProcessed();
      fixture.panel.scanner.feed(frame());
      fixture.render(frame());
      fixture.render('Current prompt only');
      vi.advanceTimersByTime(61000);
      fixture.render(frame());
      expect(fixture.emitted).not.toHaveBeenCalled();
    } finally { fixture.dispose(); }
  });

  it.each([undefined, otherCapability])('does not emit unauthenticated rendered rejection (key: %s)', (armed) => {
    vi.useFakeTimers();
    const fixture = terminalFixture();
    try {
      if (armed) fixture.panel.setProtocolCapability(armed);
      fixture.render(frame());
      fixture.child.stdout.emit('data', Buffer.from('Ordinary output\r\n'.repeat(160)));
      vi.advanceTimersByTime(500);
      expect(fixture.emitted).not.toHaveBeenCalled();
    } finally { fixture.dispose(); }
  });
});
