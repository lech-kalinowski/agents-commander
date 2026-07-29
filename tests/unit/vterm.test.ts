import { describe, expect, it } from 'vitest';
import { VTerm } from '../../src/panels/vterm.js';

describe('VTerm', () => {
  it('uses delayed autowrap at the right margin', () => {
    const terminal = new VTerm(4, 3);

    terminal.write('abcd');
    expect(terminal.getGridPlainLines()).toEqual(['abcd', '', '']);

    terminal.write('e');
    expect(terminal.getGridPlainLines()).toEqual(['abcd', 'e', '']);
  });

  it('does not add an extra line when CRLF follows a full row', () => {
    const terminal = new VTerm(4, 3);

    terminal.write('abcd\r\nX');

    expect(terminal.getGridPlainLines()).toEqual(['abcd', 'X', '']);
  });

  it('wraps wide characters and following text without corrupting cells', () => {
    const terminal = new VTerm(4, 3);
    terminal.write('ab界X');
    expect(terminal.getGridPlainLines()).toEqual(['ab界', 'X', '']);

    const wideAtMargin = new VTerm(4, 3);
    wideAtMargin.write('abc界');
    expect(wideAtMargin.getGridPlainLines()).toEqual(['abc', '界', '']);
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
});
