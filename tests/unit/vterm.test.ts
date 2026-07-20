import { describe, expect, it } from 'vitest';
import { VTerm } from '../../src/panels/vterm.js';

describe('VTerm', () => {
  it('clears saved scrollback for the xterm CSI 3 J sequence', () => {
    const terminal = new VTerm(20, 2);
    terminal.write('one\r\ntwo\r\nthree');
    expect(terminal.scrollbackLength).toBeGreaterThan(0);

    terminal.write('\x1b[3J');

    expect(terminal.scrollbackLength).toBe(0);
    expect(terminal.getGridPlainLines()).toEqual(['', '']);
  });
});
