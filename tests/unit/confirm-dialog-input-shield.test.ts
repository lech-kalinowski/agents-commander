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

  it('accepts a trusted external confirmation without leaking terminal input', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const leakedKeys: string[] = [];
    terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
    terminal.focus();

    try {
      let confirm!: () => void;
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Hardware confirmation',
        'A second validated device press confirms this action.',
        {
          externalConfirmOnly: true,
          onReady: (controller) => { confirm = controller.confirm; },
        },
      );
      confirm();

      await expect(decision).resolves.toBe(true);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });

  it('ignores keyboard approval in external-only mode but permits keyboard cancellation', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const leakedKeys: string[] = [];
    terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
    terminal.focus();

    try {
      let settled = false;
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Hardware confirmation',
        'Only a second validated device press may confirm.',
        { externalConfirmOnly: true },
      );
      void decision.then(() => { settled = true; });

      input.write('y');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      input.write('n');
      await expect(decision).resolves.toBe(false);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });

  it('keeps keyboard selection on No in external-only mode', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const leakedKeys: string[] = [];
    terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
    terminal.focus();

    try {
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Hardware confirmation',
        'Arrow keys cannot select keyboard approval.',
        { externalConfirmOnly: true },
      );
      input.write('\u001b[C');
      input.write('\r');

      await expect(decision).resolves.toBe(false);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });
});
