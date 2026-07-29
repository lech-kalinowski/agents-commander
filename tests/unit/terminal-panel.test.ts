import { StringDecoder } from 'node:string_decoder';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProtocolScanner,
  type CommanderMessage,
} from '../../src/orchestration/protocol.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { VTerm } from '../../src/panels/vterm.js';

function createPanelHarness() {
  const emitted: CommanderMessage[] = [];
  const panel: any = {
    panelIndex: 2,
    onCommanderMessage: vi.fn((msg: CommanderMessage) => emitted.push(msg)),
    orchConfig: {
      gridScanDelay: 200,
      ackTimeout: 60000,
      injectionGrace: 2500,
      dedupWindow: 15000,
    },
    recentEmissions: new Map<string, number>(),
    protocolReservations: new Map<string, { remaining: number; expiresAt: number }>(),
    pendingReplyEmissions: new Map<string, { msg: CommanderMessage; timer: ReturnType<typeof setTimeout> }>(),
    instructionEchoGuardUntil: 0,
    activeGridProtocolKeys: new Set<string>(),
    activeTailReplyKeys: new Set<string>(),
    scanner: { isMuted: false },
    vterm: {
      getTailLogicalLines: vi.fn(() => []),
    },
  };

  panel.buildEmissionKey = TerminalPanel.prototype['buildEmissionKey'];
  panel.rememberEmissionKey = TerminalPanel.prototype['rememberEmissionKey'];
  panel.rememberProtocolReservation = TerminalPanel.prototype['rememberProtocolReservation'];
  panel.pruneExpiredEmissionKeys = TerminalPanel.prototype['pruneExpiredEmissionKeys'];
  panel.pruneExpiredProtocolReservations = TerminalPanel.prototype['pruneExpiredProtocolReservations'];
  panel.emitDeduped = TerminalPanel.prototype['emitDeduped'];
  panel.reserveProtocolTextForEcho = TerminalPanel.prototype['reserveProtocolTextForEcho'];
  panel.schedulePendingReplyEmission = TerminalPanel.prototype['schedulePendingReplyEmission'];
  panel.cancelPendingReplyEmission = TerminalPanel.prototype['cancelPendingReplyEmission'];
  panel.clearPendingReplyEmissions = TerminalPanel.prototype['clearPendingReplyEmissions'];
  panel.scanGridForProtocol = TerminalPanel.prototype['scanGridForProtocol'];
  panel.feedScannerFromVTerm = TerminalPanel.prototype['feedScannerFromVTerm'];
  panel.scanRenderedTailForReplies = TerminalPanel.prototype['scanRenderedTailForReplies'];
  panel.decodePtyChunk = TerminalPanel.prototype['decodePtyChunk'];

  return { panel, emitted };
}

describe('TerminalPanel reply transport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a scrollback reply if grid scan does not catch it in time', () => {
    vi.useFakeTimers();
    const { panel, emitted } = createPanelHarness();
    const reply: CommanderMessage = {
      type: 'reply',
      sourcePanel: 2,
      sourceAgent: 'Gemini CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'GEMINI_SMOKE_OK',
    };

    panel.schedulePendingReplyEmission(reply);
    expect(emitted).toEqual([]);

    vi.advanceTimersByTime(450);

    expect(emitted).toEqual([reply]);
  });

  it('lets grid scan cancel the delayed scrollback reply fallback', () => {
    vi.useFakeTimers();
    const { panel, emitted } = createPanelHarness();
    const reply: CommanderMessage = {
      type: 'reply',
      sourcePanel: 1,
      sourceAgent: 'Codex CLI',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'CODEX_SMOKE_OK',
    };

    panel.schedulePendingReplyEmission(reply);

    const key = panel.buildEmissionKey(
      reply.type,
      reply.targetAgent,
      reply.targetPanel,
      'CODEX_SMOKE_OK',
    );

    panel.cancelPendingReplyEmission(key);
    vi.advanceTimersByTime(450);

    expect(emitted).toEqual([]);
  });

  it('allows the first reserved outgoing protocol block through, then suppresses repeats', () => {
    const { panel, emitted } = createPanelHarness();
    const query: CommanderMessage = {
      type: 'query',
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic',
      targetPanel: -1,
      content: 'agents',
    };

    panel.reserveProtocolTextForEcho(
      'Output exactly this 3-line Commander block and nothing else:\n===COMMANDER:QUERY===\nagents\n===COMMANDER:END===',
    );

    panel.emitDeduped(query);
    panel.emitDeduped(query);

    expect(emitted).toEqual([query]);
  });

  it('detects a reply from the rendered tail when grid and scrollback miss it', () => {
    const { panel, emitted } = createPanelHarness();
    panel.vterm.getTailLogicalLines.mockReturnValue([
      'some unrelated line',
      '✦ ===COMMANDER:REPLY===',
      '  GEMINI_SMOKE_OK',
      '  ===COMMANDER:END===',
    ]);

    panel.scanRenderedTailForReplies();

    expect(emitted).toEqual([
      expect.objectContaining({
        type: 'reply',
        content: 'GEMINI_SMOKE_OK',
      }),
    ]);
  });

  it('preserves split UTF-8 spinner glyphs across PTY chunks', () => {
    const { panel } = createPanelHarness();
    const decoder = new StringDecoder('utf8');
    const bytes = Buffer.from('⠋');

    expect(panel.decodePtyChunk(decoder, bytes.subarray(0, 1))).toBe('');
    expect(panel.decodePtyChunk(decoder, bytes.subarray(1))).toBe('⠋');
  });

  it('rejoins VTerm soft wraps without changing routed SEND or REPLY content', () => {
    const sendHarness = createPanelHarness();
    sendHarness.panel.agentName = 'Demo Coordinator';
    sendHarness.panel.vterm = new VTerm(47, 10);
    sendHarness.panel.vterm.write([
      '===COMMANDER:SEND:generic:2===',
      'Review brief.md and confirm that the deterministic total is 42.',
      '===COMMANDER:END===',
    ].join('\r\n'));

    sendHarness.panel.scanGridForProtocol();

    expect(sendHarness.emitted).toEqual([
      expect.objectContaining({
        type: 'send',
        content: 'Review brief.md and confirm that the deterministic total is 42.',
      }),
    ]);

    const replyHarness = createPanelHarness();
    replyHarness.panel.agentName = 'Demo Reviewer';
    replyHarness.panel.vterm = new VTerm(47, 10);
    replyHarness.panel.vterm.write([
      '===COMMANDER:REPLY===',
      'Deterministic review passed: calculateTotal([19, 23]) equals 42.',
      '===COMMANDER:END===',
    ].join('\r\n'));

    replyHarness.panel.scanGridForProtocol();

    expect(replyHarness.emitted).toEqual([
      expect.objectContaining({
        type: 'reply',
        content: 'Deterministic review passed: calculateTotal([19, 23]) equals 42.',
      }),
    ]);
  });

  it('preserves significant spaces when routed content wraps at the panel edge', () => {
    const { panel, emitted } = createPanelHarness();
    panel.agentName = 'Boundary Space Agent';
    panel.vterm = new VTerm(18, 12);
    const content = `${'A'.repeat(16)}  tail`;
    panel.vterm.write([
      '===COMMANDER:SEND:generic:2===',
      content,
      '===COMMANDER:END===',
    ].join('\r\n'));

    panel.scanGridForProtocol();

    expect(emitted).toEqual([
      expect.objectContaining({
        type: 'send',
        content,
      }),
    ]);
  });

  it('streams soft-wrapped scrollback rows as complete logical protocol lines', () => {
    const emitted: CommanderMessage[] = [];
    const vterm = new VTerm(18, 3);
    const panel: any = {
      scannerEnabled: true,
      scanner: new ProtocolScanner(0, 'Demo Coordinator', (message) => {
        emitted.push(message);
      }),
      vterm,
      lastScrollbackIndex: 0,
      scheduleGridScan: vi.fn(),
    };
    panel.feedScannerFromVTerm = TerminalPanel.prototype['feedScannerFromVTerm'];

    vterm.write([
      '===COMMANDER:SEND:generic:2===',
      'deterministic-content-without-added-whitespace',
      '===COMMANDER:END===',
      'padding-1',
      'padding-2',
      'padding-3',
      'padding-4',
    ].join('\r\n'));
    panel.feedScannerFromVTerm();

    expect(emitted).toEqual([
      expect.objectContaining({
        type: 'send',
        content: 'deterministic-content-without-added-whitespace',
      }),
    ]);
  });

  it('streams significant wrap-boundary spaces from scrollback unchanged', () => {
    const emitted: CommanderMessage[] = [];
    const vterm = new VTerm(18, 3);
    const panel: any = {
      scannerEnabled: true,
      scanner: new ProtocolScanner(0, 'Boundary Space Agent', (message) => {
        emitted.push(message);
      }),
      vterm,
      lastScrollbackIndex: 0,
      scheduleGridScan: vi.fn(),
    };
    panel.feedScannerFromVTerm = TerminalPanel.prototype['feedScannerFromVTerm'];
    const content = `${'A'.repeat(16)}  tail`;

    vterm.write([
      '===COMMANDER:SEND:generic:2===',
      content,
      '===COMMANDER:END===',
      'padding-1',
      'padding-2',
      'padding-3',
      'padding-4',
    ].join('\r\n'));
    panel.feedScannerFromVTerm();

    expect(emitted).toEqual([
      expect.objectContaining({
        type: 'send',
        content,
      }),
    ]);
  });
});

describe('TerminalPanel PTY sizing', () => {
  function createResizeHarness(width = 31, height = 12) {
    const control = {
      writable: true,
      destroyed: false,
      write: vi.fn(),
      end: vi.fn(),
    };
    const panel: any = {
      agentName: 'Resize Test',
      box: {},
      outputBox: { width, height },
      vterm: { resize: vi.fn() },
      resizeControl: control,
      lastPtySize: null,
      scheduleRender: vi.fn(),
    };
    panel.getTerminalDimensions = TerminalPanel.prototype['getTerminalDimensions'];
    panel.sendPtyResize = TerminalPanel.prototype['sendPtyResize'];
    panel.closeResizeControl = TerminalPanel.prototype['closeResizeControl'];
    panel.resize = TerminalPanel.prototype.resize;
    return { panel, control };
  }

  it('uses the actual drawable panel size without fake minimum dimensions', () => {
    const { panel } = createResizeHarness(31, 12);
    expect(panel.getTerminalDimensions()).toEqual({ cols: 30, rows: 11 });

    panel.outputBox.width = 1;
    panel.outputBox.height = 0;
    expect(panel.getTerminalDimensions()).toEqual({ cols: 1, rows: 1 });
  });

  it('frames and deduplicates resize messages on the dedicated pipe', () => {
    const { panel, control } = createResizeHarness();

    panel.sendPtyResize(30, 11);
    panel.sendPtyResize(30, 11);
    panel.sendPtyResize(45, 20);

    expect(control.write.mock.calls).toEqual([
      ['resize 30 11\n'],
      ['resize 45 20\n'],
    ]);
  });

  it('resizes both the emulator and live PTY before refreshing content', () => {
    const { panel, control } = createResizeHarness(21, 9);

    panel.resize({ top: 1, left: 2, width: 40, height: 20 });

    expect(panel.vterm.resize).toHaveBeenCalledWith(20, 8);
    expect(control.write).toHaveBeenCalledWith('resize 20 8\n');
    expect(panel.scheduleRender).toHaveBeenCalledOnce();
  });
});
