import { StringDecoder } from 'node:string_decoder';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommanderMessage } from '../../src/orchestration/protocol.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';

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
      getTail: vi.fn(() => []),
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
    panel.vterm.getTail.mockReturnValue([
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
});
