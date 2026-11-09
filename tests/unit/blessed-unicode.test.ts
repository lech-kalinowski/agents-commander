import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it } from 'vitest';
import { VTerm } from '../../src/panels/vterm.js';
import { ensureBlessedEmojiWidth } from '../../src/screen/unicode-compat.js';

describe('Blessed incremental Unicode painting', () => {
  it.each(['\u{1f3d3}', '\u23fa\ufe0f', '\u00a9\ufe0f', '\u754c', '\u{20000}', '\u273b', '\u23fa'])(
    'erases the entire old row after replacing %s without leaving ghost characters', async (symbol) => {
      ensureBlessedEmojiWidth();
      // Repeated panel creation must not wrap the shared width function again.
      const unicode = (blessed as any).unicode;
      const width = unicode.charWidth;
      ensureBlessedEmojiWidth();
      expect(unicode.charWidth).toBe(width);
      const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
      const output = Object.assign(new PassThrough(), { isTTY: true, columns: 40, rows: 8 });
      const physical = new VTerm(40, 8);
      output.on('data', data => physical.write(data.toString('utf8')));
      const screen = blessed.screen({ input, output, terminal: 'xterm-256color',
        fullUnicode: true, smartCSR: false });
      try {
        const box = blessed.box({ parent: screen, top: 1, left: 1, width: 30, height: 3,
          content: `${symbol} Pong!` });
        screen.render();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(physical.getGridPlainLines()[1]).toBe(` ${symbol} Pong!`);
        box.setContent('Done');
        screen.render();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(physical.getGridPlainLines()[1]).toBe(' Done');
      } finally {
        screen.destroy();
        input.destroy();
        output.destroy();
      }
    },
  );
});
