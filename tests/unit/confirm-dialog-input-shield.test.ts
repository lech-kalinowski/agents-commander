import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { isDialogActive } from '../../src/utils/dialog-state.js';

function terminalStream(columns: number, rows: number): PassThrough {
  const stream = new PassThrough();
  Object.assign(stream, {
    isTTY: true,
    columns,
    rows,
    setRawMode: vi.fn(),
  });
  return stream;
}

describe('confirmation dialog terminal input shield', () => {
  it('contains Blessed synthetic enter plus return before restoring terminal focus', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const programKeys: string[] = [];
    const leakedKeys: string[] = [];
    screen.program.on('keypress', (_character, key) => {
      programKeys.push(key.name);
    });
    terminal.on('keypress', (_character, key) => {
      leakedKeys.push(key.name);
    });
    terminal.focus();

    try {
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Guarded decision',
        'Default No must not leak Enter to the terminal.',
      );
      input.write('\r');

      await expect(decision).resolves.toBe(false);
      expect(programKeys).toEqual(['enter', 'return']);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });
});
