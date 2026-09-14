import { describe, expect, it } from 'vitest';
import { VTerm } from '../../src/panels/vterm.js';

describe('VTerm protocol-row provenance', () => {
  it('records a cursor-addressed row-start write without changing real DEC wrap links', () => {
    const terminal = new VTerm(12, 4);
    terminal.write('x'.repeat(12) + 'old text');
    terminal.write('\x1b[2;1H');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBeUndefined();

    terminal.write('new text');
    expect(terminal.getGridPlainRows()[1]).toEqual({
      text: 'new text', wrapsToNext: false, startsAfterCursorMove: true,
    });
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(true);
    expect(terminal.getGridLogicalLines()[0]).toBe('x'.repeat(12) + 'new text');
  });

  it('does not mark ordinary stream wraps as independently addressed row starts', () => {
    const terminal = new VTerm(8, 4);
    terminal.write('\x1b[1;1H12345678inline text');
    const rows = terminal.getGridPlainRows();
    expect(rows[0].startsAfterCursorMove).toBe(true);
    expect(rows[1].startsAfterCursorMove).toBeUndefined();
    expect(rows[2].startsAfterCursorMove).toBeUndefined();
    expect(terminal.getGridLogicalLines()[0]).toBe('12345678inline text');
  });

  it.each(['\r', '\n', '\t', '\b'])(
    'ordinary flow control %j cancels pending addressed-write provenance',
    (control) => {
      const terminal = new VTerm(12, 4);
      terminal.write(`\x1b[2;1H${control}text`);
      expect(terminal.getGridPlainRows().some((row) => row.startsAfterCursorMove)).toBe(false);
    },
  );

  it('keeps a pending move across chunk boundaries, SGR and an erase before the write', () => {
    const terminal = new VTerm(12, 4);
    terminal.write('\x1b[2;');
    terminal.write('1H\x1b[32m\x1b[2K');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBeUndefined();
    terminal.write('text');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBe(true);
  });

  it('consumes the move on the first printable and replaces provenance on a natural rewrite', () => {
    const terminal = new VTerm(12, 4);
    terminal.write('\x1b[2;3Htail');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBeUndefined();
    terminal.write('\x1b[2;1Haddressed');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[2;8Hend');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBe(true);
    terminal.write('\rnatural');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBeUndefined();
  });

  it.each(['\x1b[A', '\x1b[B', '\x1b[E', '\x1b[F', '\x1b[1G', '\x1b[2;1f', '\x1b[2d', '\x1bM'])(
    'records explicit cursor movement %j followed by a first-cell write',
    (movement) => {
      const terminal = new VTerm(12, 4);
      terminal.write(`\x1b[2;1H${movement}moved`);
      expect(terminal.getGridPlainRows()[terminal.curRow].startsAfterCursorMove).toBe(true);
    },
  );

  it('treats explicit cursor restoration as a move but not restored delayed autowrap', () => {
    const terminal = new VTerm(8, 4);
    terminal.write('\x1b[2;1H\x1b7later\x1b8restored');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[1;1H12345678\x1b7\x1b[3;1Hother\x1b8x');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBeUndefined();
  });

  it('retains provenance with physical rows through scrollback rollover and clearing', () => {
    const terminal = new VTerm(12, 2, 2);
    terminal.write('\x1b[1;1Hfirst\r\nsecond\r\nthird');
    expect(terminal.getScrollbackPlainRow(0).startsAfterCursorMove).toBe(true);
    expect(terminal.getTailPlainRows()[0].startsAfterCursorMove).toBe(true);
    terminal.write('\r\nfourth\r\nfifth');
    expect(terminal.getTailPlainRows().some((row) => row.startsAfterCursorMove)).toBe(false);
    terminal.write('\x1b[1;1Hnew\r\nnext\r\nlast');
    expect(terminal.getPrimaryScrollbackPlainRowAt(terminal.primaryScrollbackEndIndex - 1)?.startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[3J');
    expect(terminal.getTailPlainRows().some((row) => row.startsAfterCursorMove)).toBe(false);
  });

  it('keeps primary provenance available while alternate-screen rows remain independent', () => {
    const terminal = new VTerm(12, 2);
    terminal.write('\x1b[1;1Hprimary\r\nnext\r\nlast\x1b[?1049h');
    expect(terminal.getPrimaryScrollbackPlainRowAt(0)?.startsAfterCursorMove).toBe(true);
    expect(terminal.getTailPlainRows().some((row) => row.startsAfterCursorMove)).toBe(false);
    terminal.write('\x1b[2;1Halt');
    expect(terminal.getTailPlainRows()[1].startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[?1049l');
    expect(terminal.getTailPlainRows()[0].text).toBe('primary');
    expect(terminal.getTailPlainRows()[0].startsAfterCursorMove).toBe(true);
    expect(terminal.getGridPlainRows().some((row) => row.startsAfterCursorMove)).toBe(false);
  });

  it('preserves first-cell provenance across resizing and whole-row moves, not blank insertions', () => {
    const terminal = new VTerm(12, 4);
    terminal.write('\x1b[2;1Htext');
    terminal.resize(20, 5);
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[1;1H\x1b[L');
    expect(terminal.getGridPlainRows()[0].startsAfterCursorMove).toBeUndefined();
    expect(terminal.getGridPlainRows()[2].startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[M');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[2;3H\x1b[K');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBe(true);
    terminal.write('\x1b[2;1H\x1b[2K');
    expect(terminal.getGridPlainRows()[1].startsAfterCursorMove).toBeUndefined();
  });

  it('clears addressed provenance and pending cursor state on full terminal reset', () => {
    const terminal = new VTerm(12, 4);
    terminal.write('\x1b[2;1Htext\x1b[3;1H\x1bcnatural');
    expect(terminal.getGridPlainRows().some((row) => row.startsAfterCursorMove)).toBe(false);
  });

  it('exposes detached display-column cells with backgrounds, wide continuations and provenance', () => {
    const terminal = new VTerm(8, 3);
    terminal.write('\x1b[2;1H\x1b[44m界x');
    const rows = terminal.getGridCellRows();
    expect(rows[1].startsAfterCursorMove).toBe(true);
    expect(rows[1].cells).toHaveLength(8);
    expect(rows[1].cells.slice(0, 3)).toEqual([
      { char: '界', bg: 4 }, { char: '', bg: 4 }, { char: 'x', bg: 4 },
    ]);
    (rows[1].cells[0] as { char: string }).char = 'changed snapshot';
    expect(terminal.getGridPlainRows()[1].text).toBe('界x');
    terminal.write('\r\nnext');
    expect(rows[2].cells.every((cell) => cell.char === ' ')).toBe(true);
  });
});
