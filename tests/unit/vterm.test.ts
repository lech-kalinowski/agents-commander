import { describe, expect, it } from 'vitest';
import { VTerm } from '../../src/panels/vterm.js';

describe('VTerm', () => {
  it('uses delayed autowrap at the right margin', () => {
    const terminal = new VTerm(4, 3);

    terminal.write('abcd');
    expect(terminal.getGridPlainLines()).toEqual(['abcd', '', '']);
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(false);

    terminal.write('e');
    expect(terminal.getGridPlainLines()).toEqual(['abcd', 'e', '']);
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(true);
    expect(terminal.getGridLogicalLines()).toEqual(['abcde', '']);
  });

  it('does not add an extra line when CRLF follows a full row', () => {
    const terminal = new VTerm(4, 3);

    terminal.write('abcd\r\nX');

    expect(terminal.getGridPlainLines()).toEqual(['abcd', 'X', '']);
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(false);
    expect(terminal.getGridLogicalLines()).toEqual(['abcd', 'X', '']);
  });

  it('wraps wide characters and following text without corrupting cells', () => {
    const terminal = new VTerm(4, 3);
    terminal.write('ab界X');
    expect(terminal.getGridPlainLines()).toEqual(['ab界', 'X', '']);

    const wideAtMargin = new VTerm(4, 3);
    wideAtMargin.write('abc界');
    expect(wideAtMargin.getGridPlainLines()).toEqual(['abc', '界', '']);
    expect(wideAtMargin.getGridPlainRows()[0].wrapsToNext).toBe(true);
  });

  it('attaches combining marks to a character at the right margin', () => {
    const terminal = new VTerm(4, 2);

    terminal.write('abcd\u0301');

    expect(terminal.getGridPlainLines()).toEqual(['abcd\u0301', '']);
  });

  it('routes CSI REP through delayed autowrap', () => {
    const terminal = new VTerm(4, 3);

    terminal.write('abcd\x1b[2b');

    expect(terminal.getGridPlainLines()).toEqual(['abcd', 'dd', '']);
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(true);
  });

  it('preserves soft-wrap boundaries as rows enter scrollback', () => {
    const terminal = new VTerm(4, 2);

    terminal.write('abcde\r\nZ\r\nQ');

    expect(terminal.getScrollbackPlainRow(0)).toEqual({
      text: 'abcd',
      wrapsToNext: true,
    });
    expect(terminal.getScrollbackPlainRow(1)).toEqual({
      text: 'e',
      wrapsToNext: false,
    });
    expect(terminal.getTailLogicalLines(10)).toContain('abcde');
  });

  it('preserves a bottom-row continuation when delayed autowrap scrolls', () => {
    const terminal = new VTerm(4, 2);

    terminal.write('abcdefghi');

    expect(terminal.getTailLogicalLines(10)).toEqual(['abcdefghi']);
  });

  it('preserves significant spaces at grid and scrollback wrap boundaries', () => {
    const visible = new VTerm(5, 3);
    visible.write('abc  d');

    expect(visible.getGridPlainRows()[0]).toEqual({
      text: 'abc  ',
      wrapsToNext: true,
    });
    expect(visible.getGridLogicalLines()[0]).toBe('abc  d');

    const scrolled = new VTerm(5, 2);
    scrolled.write('abc  d\r\nZ\r\nQ');

    expect(scrolled.getScrollbackPlainRow(0)).toEqual({
      text: 'abc  ',
      wrapsToNext: true,
    });
    expect(scrolled.getTailLogicalLines(10)).toContain('abc  d');
  });

  it('keeps wrap metadata aligned through scrolling and line insertion/deletion', () => {
    const scrolled = new VTerm(4, 3);
    scrolled.write('abcde\x1b[1S\x1b[1T');
    expect(scrolled.getGridPlainRows()).toHaveLength(3);
    expect(scrolled.getGridPlainRows().every((row) => !row.wrapsToNext)).toBe(true);
    expect(scrolled.getScrollbackPlainRow(0).wrapsToNext).toBe(true);

    const edited = new VTerm(4, 3);
    edited.write('abcde\x1b[2;1H\x1b[1L');
    expect(edited.getGridPlainRows()).toHaveLength(3);
    expect(edited.getGridPlainRows()[1].wrapsToNext).toBe(false);
    edited.write('\x1b[1M');
    expect(edited.getGridPlainRows()).toHaveLength(3);
    expect(edited.getGridPlainRows()[2].wrapsToNext).toBe(false);
  });

  it('retains shifted soft-wrap pairs through CSI scroll-down', () => {
    const terminal = new VTerm(4, 4);
    terminal.write('abcde\x1b[1T');

    expect(terminal.getGridPlainRows().map((row) => row.wrapsToNext)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(terminal.getGridLogicalLines()).toEqual(['', 'abcde', '']);
  });

  it('breaks both changed boundaries around a partial-region scroll-up', () => {
    const terminal = new VTerm(4, 5);
    terminal.write('abcdefghijklmnopq\x1b[2;4r\x1b[1S');

    expect(terminal.getGridPlainRows().map((row) => row.wrapsToNext)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(terminal.getGridLogicalLines()).toEqual(['abcd', 'ijklmnop', '', 'q']);
  });

  it('breaks only invalid soft-wrap boundaries when inserting or deleting lines', () => {
    const insertedBetween = new VTerm(4, 4);
    insertedBetween.write('abcde\x1b[2;1H\x1b[1L');
    expect(insertedBetween.getGridPlainRows()[0].wrapsToNext).toBe(false);
    expect(insertedBetween.getGridLogicalLines()).toEqual(['abcd', '', 'e', '']);

    const shiftedTogether = new VTerm(4, 4);
    shiftedTogether.write('abcde\x1b[1;1H\x1b[1L');
    expect(shiftedTogether.getGridPlainRows()[1].wrapsToNext).toBe(true);
    expect(shiftedTogether.getGridLogicalLines()).toEqual(['', 'abcde', '']);

    const deletedContinuation = new VTerm(4, 4);
    deletedContinuation.write('abcde\x1b[2;1H\x1b[1M');
    expect(deletedContinuation.getGridPlainRows()[0].wrapsToNext).toBe(false);
    expect(deletedContinuation.getGridLogicalLines()).toEqual(['abcd', '', '', '']);
  });

  it('keeps alternate and primary buffers safe across resizes', () => {
    const terminal = new VTerm(8, 3);
    terminal.write('primary\x1b[?1049halternate');

    expect(() => {
      terminal.resize(2, 2);
      terminal.resize(10, 4);
      terminal.write('\x1b[?1049lZ');
    }).not.toThrow();

    expect(terminal.getGridPlainLines()).toHaveLength(4);
  });

  it('keeps independent wrap metadata across alternate-screen cycles and resize', () => {
    const terminal = new VTerm(4, 3);
    terminal.write('abcde');
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(true);

    terminal.write('\x1b[?1049h12345');
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(true);
    terminal.resize(6, 4);
    terminal.write('\x1b[?1049l');

    expect(terminal.getGridPlainRows()).toHaveLength(4);
    expect(terminal.getGridPlainRows()[0].wrapsToNext).toBe(true);
    expect(terminal.getGridLogicalLines()[0]).toBe('abcde');
  });

  it('does not overwrite a full margin cell after same-width, grow, or shrink resizes', () => {
    const sameWidth = new VTerm(4, 3);
    sameWidth.write('abcd');
    sameWidth.resize(4, 3);
    sameWidth.write('X');
    expect(sameWidth.getGridPlainLines()).toEqual(['abcd', 'X', '']);

    const grown = new VTerm(4, 3);
    grown.write('abcd');
    grown.resize(5, 3);
    grown.write('X');
    expect(grown.getGridPlainLines()).toEqual(['abcd', 'X', '']);

    const shrunk = new VTerm(4, 3);
    shrunk.write('abcd');
    shrunk.resize(3, 3);
    shrunk.write('X');
    expect(shrunk.getGridPlainLines()).toEqual(['abc', 'X', '']);
  });

  it('preserves pending wrap in alternate-screen and saved-cursor state', () => {
    const alternate = new VTerm(4, 3);
    alternate.write('abcd\x1b[?1049h');
    alternate.resize(4, 3);
    alternate.write('\x1b[?1049lX');
    expect(alternate.getGridPlainLines()).toEqual(['abcd', 'X', '']);

    const savedCursor = new VTerm(4, 3);
    savedCursor.write('abcd\x1b7');
    savedCursor.resize(4, 3);
    savedCursor.write('\x1b8X');
    expect(savedCursor.getGridPlainLines()).toEqual(['abcd', 'X', '']);
  });

  it('removes wide glyphs that are clipped by a resize', () => {
    const clippedAtEnd = new VTerm(4, 2);
    clippedAtEnd.write('ab界');
    clippedAtEnd.resize(3, 2);
    expect(clippedAtEnd.getGridPlainLines()).toEqual(['ab', '']);

    const clippedToOneColumn = new VTerm(2, 2);
    clippedToOneColumn.write('界');
    clippedToOneColumn.resize(1, 2);
    expect(clippedToOneColumn.getGridPlainLines()).toEqual(['', '']);

    const savedAlternateBuffer = new VTerm(4, 2);
    savedAlternateBuffer.write('ab界\x1b[?1049h');
    savedAlternateBuffer.resize(3, 2);
    savedAlternateBuffer.write('\x1b[?1049l');
    expect(savedAlternateBuffer.getGridPlainLines()).toEqual(['ab', '']);
  });

  it('clears both halves when overwriting a wide-character continuation', () => {
    const terminal = new VTerm(4, 2);
    terminal.write('界\x1b[2Ga');

    expect(terminal.getGridPlainLines()).toEqual([' a', '']);
  });

  it('uses a single-cell replacement for wide glyphs in a one-column grid', () => {
    const terminal = new VTerm(1, 2);
    terminal.write('界');

    expect(terminal.getGridPlainLines()).toEqual(['\uFFFD', '']);
  });

  it('clamps a saved cursor before restoring after a shrink', () => {
    const terminal = new VTerm(8, 3);
    terminal.write('abcdef\x1b7');

    expect(() => {
      terminal.resize(2, 1);
      terminal.write('\x1b8X');
    }).not.toThrow();

    expect(terminal.getGridPlainLines()).toHaveLength(1);
  });

  it('normalizes invalid dimensions and survives repeated alt-screen cycles', () => {
    const terminal = new VTerm(0, -2);
    expect(terminal.colCount).toBe(1);
    expect(terminal.getGridPlainLines()).toHaveLength(1);

    expect(() => {
      for (let index = 0; index < 5; index++) {
        terminal.write('\x1b[?1049hX');
        terminal.resize(index % 2 === 0 ? 0 : Number.NaN, index - 3);
        terminal.write('\x1b[?1049lY');
      }
    }).not.toThrow();

    expect(terminal.colCount).toBe(1);
    expect(terminal.getGridPlainLines()).toHaveLength(1);
  });

  it('clears saved scrollback for the xterm CSI 3 J sequence', () => {
    const terminal = new VTerm(20, 2);
    terminal.write('one\r\ntwo\r\nthree');
    expect(terminal.scrollbackLength).toBeGreaterThan(0);

    terminal.write('\x1b[3J');

    expect(terminal.scrollbackLength).toBe(0);
    expect(terminal.getGridPlainLines()).toEqual(['', '']);
  });

  it('clears soft-wrap metadata when display and line erases remove boundaries', () => {
    const display = new VTerm(4, 2);
    display.write('abcde');
    expect(display.getGridPlainRows()[0].wrapsToNext).toBe(true);
    display.write('\x1b[2J');
    expect(display.getGridPlainRows().every((row) => !row.wrapsToNext)).toBe(true);

    const line = new VTerm(4, 2);
    line.write('abcde\x1b[1;1H\x1b[2K');
    expect(line.getGridPlainRows()[0].wrapsToNext).toBe(false);
  });
});
