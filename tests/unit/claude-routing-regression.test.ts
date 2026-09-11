import { describe, expect, it, vi } from 'vitest';
import { ProtocolScanner } from '../../src/orchestration/protocol.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { VTerm } from '../../src/panels/vterm.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Public synthetic capability only; no copied credentials or session output.
const capability = 'q'.repeat(43);
const body = 'Synthetic Claude-to-Codex routing check.';
const header = `●===COMMANDER:SEND:codex:2:${capability}:1===`;
const footer = `  ===COMMANDER:END:${capability}:1===`;
const frame = `${header}\r\n  ${body}\r\n${footer}\r\n`;

function fixture(columns = 100) {
  const emitted = vi.fn();
  const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex: 0, agentName: 'Synthetic Claude', vterm: new VTerm(columns, 20),
    protocolCapability: capability, scanner: { isMuted: false },
    onCommanderMessage: emitted,
    activeGridProtocolKeys: new Set(), activeTailReplyKeys: new Set(),
    pendingReplyEmissions: new Map(), instructionEchoGuardUntil: 0,
    orchConfig: { maxContentLines: 500, maxContentBytes: 262144, dedupWindow: 15000 },
    updateHeader: vi.fn(), scheduleRender: vi.fn(),
  });
  return { panel, emitted };
}

describe('Claude-style protocol presentation regression', () => {
  it('accepts adjacent bullet headers and indented bodies/footers directly', () => {
    const emitted = vi.fn();
    const scanner = new ProtocolScanner(0, 'Synthetic Claude', emitted);
    scanner.setProtocolCapability(capability);
    scanner.feed(frame);
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0]).toMatchObject({ type: 'send', targetAgent: 'codex', targetPanel: 1, sequence: 1, content: body });
  });

  it.each([40, 80, 120])('accepts styled, chunked terminal output at %i columns without another redraw', (columns) => {
    const { panel, emitted } = fixture(columns);
    const output = `\x1b[?1049h\x1b[37m${frame}\x1b[0m`;
    for (let offset = 0; offset < output.length; offset += 7) panel.vterm.write(output.slice(offset, offset + 7));
    panel.scanGridForProtocol();
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0]).toMatchObject({ type: 'send', targetPanel: 1, content: body });
    panel.scanGridForProtocol();
    expect(emitted).toHaveBeenCalledOnce();
  });

  it.each([
    ['EL2', '\x1b[2K'],
    ['EL0 at column one', '\x1b[K'],
    ['EL1 at final column', '\x1b[100G\x1b[1K\x1b[1G'],
    ['full-width ECH', '\x1b[100X'],
    ['ED0 at column one', '\x1b[J'],
    ['ED1 at final column', '\x1b[100G\x1b[1J\x1b[1G'],
  ])('does not join a %s-erased/replaced continuation row to unrelated previous text', (_label, erase) => {
    const { panel, emitted } = fixture();
    panel.vterm.write(`${'x'.repeat(100)}old continuation`);
    expect(panel.vterm.getGridPlainRows()[0].wrapsToNext).toBe(true);
    // A TUI moves to the old continuation and erases that whole row before
    // painting a new response. The physical markers are complete immediately.
    panel.vterm.write(`\x1b[2;1H${erase}${frame}`);
    expect(panel.vterm.getGridPlainLines()[1]).toBe(header);
    panel.scanGridForProtocol();
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0].content).toBe(body);
  });

  it('routes after reused header, body and footer rows are separately erased and cursor-painted', () => {
    const { panel, emitted } = fixture();
    panel.vterm.write('x'.repeat(350));
    const output = [header, `  ${body}`, footer];
    for (const [index, text] of output.entries()) {
      panel.vterm.write(`\x1b[${index + 2};1H\x1b[2K${text}`);
    }
    expect(panel.vterm.getGridPlainLines().slice(1, 4)).toEqual(output);
    panel.scanGridForProtocol();
    expect(emitted).toHaveBeenCalledOnce();
    expect(emitted.mock.calls[0][0].content).toBe(body);
    // A later repaint of those same sequence-bearing rows must not resend.
    for (const [index, text] of output.entries()) {
      panel.vterm.write(`\x1b[${index + 2};1H\x1b[2K${text}`);
    }
    panel.scanGridForProtocol();
    expect(emitted).toHaveBeenCalledOnce();
  });

  it.each([
    ['EL0', '\x1b[3G\x1b[K'],
    ['EL1', '\x1b[2G\x1b[1K'],
    ['ECH', '\x1b[2G\x1b[2X'],
  ])('preserves incoming continuation after a partial %s edit', (_label, erase) => {
    const terminal = new VTerm(5, 4);
    terminal.write('abcdefghijk');
    terminal.write(`\x1b[2;1H${erase}`);
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(true);
    expect(terminal.getGridLogicalLines()[0]).toMatch(/^abcde/u);
  });

  it.each(['\x1b[2K', '\x1b[K', '\x1b[2J'])('breaks the old scrollback continuation when the first visible row is fully erased with %s', (erase) => {
    const terminal = new VTerm(5, 2);
    terminal.write('abcdefghijkl');
    expect(terminal.getScrollbackPlainRow(0).wrapsToNext).toBe(true);
    terminal.write(`\x1b[1;1H${erase}NEW`);
    expect(terminal.getScrollbackPlainRow(0).wrapsToNext).toBe(false);
    expect(terminal.getTailLogicalLines(10)[0]).toBe('abcde');
    expect(terminal.getTailLogicalLines(10)[1]).toBe('NEW');
  });

  it('does not change primary-buffer wrap history when an alternate-buffer row is erased', () => {
    const terminal = new VTerm(5, 2);
    terminal.write('abcdefghijkl');
    terminal.write('\x1b[?1049h\x1b[2JNEW\x1b[?1049l');
    expect(terminal.getScrollbackPlainRow(0).wrapsToNext).toBe(true);
    expect(terminal.getTailLogicalLines(10)).toEqual(['abcdefghijkl']);
  });
});
