import { describe, expect, it, vi } from 'vitest';
import { ProtocolScanner, promptProtocolSequences } from '../../src/orchestration/protocol.js';
import { VTerm } from '../../src/panels/vterm.js';

vi.mock('../../src/utils/logger.js', () => ({ logger: {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
} }));

const capability = 'a'.repeat(43);
const marker = (type: string, n = 1, cap = capability) => `===COMMANDER:${type}:${cap}:${n}===`;
const frame = (body: string, n = 1) => `${marker('REPLY', n)}\r\n${body}\r\n${marker('END', n)}\r\n`;
function scanner() {
  const received = vi.fn();
  const parser = new ProtocolScanner(0, 'Synthetic', received);
  parser.setProtocolCapability(capability);
  return { parser, received };
}

describe('cursor-addressed protocol rows', () => {
  it.each([25, 48, 75, 104])('recovers a repainted header at %i columns, with exact wrapped body', (cols) => {
    const terminal = new VTerm(cols, 24);
    terminal.write('x'.repeat(cols) + 'old continuation');
    const body = `Hello 🙂 ${'significant   spaces '.repeat(8)}done`;
    terminal.write(`\x1b[2;1H${frame(body)}`);
    const { parser, received } = scanner();
    for (const row of terminal.getGridPlainRows()) parser.feedTerminalRow(row);
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0]).toMatchObject({ type: 'reply', content: body, sequence: 1 });
  });

  it('recovers across scrollback/grid and arbitrary row delivery batches', () => {
    const terminal = new VTerm(48, 4);
    terminal.write('x'.repeat(48) + 'old continuation');
    terminal.write(`\x1b[2;1H${frame('complete across history')}`);
    const { parser, received } = scanner();
    for (let index = terminal.primaryScrollbackStartIndex; index < terminal.primaryScrollbackEndIndex; index++) {
      parser.feedTerminalRow(terminal.getPrimaryScrollbackPlainRowAt(index)!);
    }
    for (const row of terminal.getGridPlainRows()) parser.feedTerminalRow(row);
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0].content).toBe('complete across history');
  });

  it('does not let a repainted nested header hijack a pending wrapped outer header', () => {
    const { parser, received } = scanner();
    parser.feedTerminalRow({ text: marker('SEND:codex:4'), wrapsToNext: true });
    parser.feedTerminalRow({ text: marker('REPLY', 2), wrapsToNext: false, startsAfterCursorMove: true });
    parser.feedTerminalRow({ text: 'nested example', wrapsToNext: false });
    parser.feedTerminalRow({ text: marker('END', 2), wrapsToNext: false });
    expect(received).not.toHaveBeenCalled();
    parser.feedTerminalRow({ text: marker('END'), wrapsToNext: false });
    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0][0]).toMatchObject({ type: 'send', sequence: 1 });
  });

  it.each([marker('REPLY', 1, 'b'.repeat(43)), '===COMMANDER:REPLY===',
    `===COMMANDER:REPLY:${capability}:01===`, `${marker('REPLY')} unrelated suffix`])(
    'never recovers an unauthorized or malformed physical header: %s', (header) => {
      const { parser, received } = scanner();
      parser.feedTerminalRow({ text: 'old unrelated prefix', wrapsToNext: true });
      parser.feedTerminalRow({ text: header, wrapsToNext: false, startsAfterCursorMove: true });
      parser.feedTerminalRow({ text: 'not an action', wrapsToNext: false });
      parser.feedTerminalRow({ text: marker('END'), wrapsToNext: false });
      expect(received).not.toHaveBeenCalled();
    },
  );

  it('bounds unfinished repaint candidates and drops them on capability rotation', () => {
    const { parser, received } = scanner();
    parser.feedTerminalRow({ text: 'old', wrapsToNext: true });
    parser.feedTerminalRow({ text: '===COMMANDER:', wrapsToNext: true, startsAfterCursorMove: true });
    for (let n = 0; n < 100; n++) parser.feedTerminalRow({ text: 'x'.repeat(100), wrapsToNext: true });
    expect((parser as any).repaintCandidate).toBeNull();
    expect((parser as any).bufferBytes).toBeLessThanOrEqual(5000);
    parser.setProtocolCapability('b'.repeat(43));
    for (const text of frame('old capability').split('\r\n')) parser.feedTerminalRow({ text, wrapsToNext: false });
    expect(received).not.toHaveBeenCalled();
  });

  it('reserves prompt identities without quadratic malformed-marker scanning', () => {
    const text = '='.repeat(262144) + 'COMMANDER:broken ' + '===COMMANDER:broken'.repeat(10000);
    expect(promptProtocolSequences(text, capability)).toEqual([]);
    expect(promptProtocolSequences(`Inline: ${marker('REPLY', 8)} and ${marker('END', 8)}`, capability)).toEqual([8]);
    expect(promptProtocolSequences(`Example: ${marker(`SEND:codex:${'0'.repeat(300)}4`, 9)}`, capability)).toEqual([9]);
  });
});
