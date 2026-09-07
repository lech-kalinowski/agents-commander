import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import {
  showConfirmDialog,
  type ConfirmDialogController,
} from '../../src/screen/dialog/confirm-dialog.js';
import { closeDialogsForScreen, isDialogActive } from '../../src/utils/dialog-state.js';

function fixture() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const terminal = blessed.box({ parent: screen, keys: true, input: true });
  const controllers: ConfirmDialogController[] = [];
  terminal.focus();
  return {
    input, screen, terminal,
    open(title: string) {
      return showConfirmDialog(screen, getTheme('midnight'), title, 'Synthetic confirmation?', {
        onReady: (controller) => controllers.push(controller),
      });
    },
    async dispose() {
      for (const controller of controllers) controller.cancel();
      await Promise.resolve();
      closeDialogsForScreen(screen);
      screen.destroy();
      input.destroy();
      output.destroy();
    },
  };
}

describe('confirmation dialog owner cancellation', () => {
  it('does not release a newly opened modal from an older deferred cleanup', async () => {
    const f = fixture();
    try {
      const first = f.open('First');
      closeDialogsForScreen(f.screen);
      const second = f.open('Second');
      const secondDialog = f.screen.focused;
      await expect(first).resolves.toBe(false);

      expect(isDialogActive()).toBe(true);
      expect(f.screen.focused).toBe(secondDialog);
      f.input.write('n');
      await expect(second).resolves.toBe(false);
      expect(f.screen.focused).toBe(f.terminal);
      expect(isDialogActive()).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it('cancels a queued approval when the owning screen cancels before dispatch completes', async () => {
    const f = fixture();
    try {
      const decision = f.open('Cancelled before approval completes');
      f.input.write('y');
      closeDialogsForScreen(f.screen);
      await expect(decision).resolves.toBe(false);
      expect(isDialogActive()).toBe(false);
      expect(f.screen.focused).toBe(f.terminal);
    } finally {
      await f.dispose();
    }
  });

  it('retains the enclosing modal when only the inner confirmation completes', async () => {
    const f = fixture();
    try {
      const outer = f.open('Outer');
      const outerDialog = f.screen.focused;
      const inner = f.open('Inner');
      f.input.write('n');
      await expect(inner).resolves.toBe(false);
      expect(isDialogActive()).toBe(true);
      expect(f.screen.focused).toBe(outerDialog);
      f.input.write('n');
      await expect(outer).resolves.toBe(false);
      expect(isDialogActive()).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it('cancels every nested dialog without releasing a replacement modal', async () => {
    const f = fixture();
    try {
      const first = f.open('First');
      const second = f.open('Second');
      closeDialogsForScreen(f.screen);
      const replacement = f.open('Replacement');
      const replacementDialog = f.screen.focused;
      await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
      expect(isDialogActive()).toBe(true);
      expect(f.screen.focused).toBe(replacementDialog);
      f.input.write('n');
      await expect(replacement).resolves.toBe(false);
      expect(isDialogActive()).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it('does not approve after the owning screen is destroyed during dispatch', async () => {
    const f = fixture();
    try {
      const decision = f.open('Destroyed during approval');
      f.input.write('y');
      f.screen.destroy();
      await expect(decision).resolves.toBe(false);
      expect(isDialogActive()).toBe(false);
    } finally {
      await f.dispose();
    }
  });
});
