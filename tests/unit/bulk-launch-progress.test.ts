import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showBulkLaunchProgress } from '../../src/screen/dialog/bulk-launch-progress.js';
import { closeDialogsForScreen, isDialogActive, placeBelowDialogs } from '../../src/utils/dialog-state.js';

function fixture() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const terminal = blessed.box({ parent: screen, keys: true, input: true });
  const leaked: string[] = [];
  terminal.on('keypress', (_ch, key) => leaked.push(key.name));
  terminal.focus();
  return { input, output, screen, terminal, leaked, dispose() {
    closeDialogsForScreen(screen); screen.destroy(); input.destroy(); output.destroy();
  } };
}

describe('bulk-launch progress input shield', () => {
  it('keeps newly allocated content below the mouse shield and every nested modal', () => {
    const f = fixture();
    try {
      const first = showBulkLaunchProgress(f.screen, getTheme('midnight'), 16);
      const firstDialog = f.screen.focused;
      const shield = f.screen.children[f.screen.children.indexOf(firstDialog) - 1];
      const second = showBulkLaunchProgress(f.screen, getTheme('midnight'), 20);
      const topDialog = f.screen.focused;
      const panel = blessed.box({ parent: f.screen, keys: true, mouse: true });
      expect(f.screen.children.indexOf(panel)).toBeGreaterThan(f.screen.children.indexOf(topDialog));
      placeBelowDialogs(f.screen, panel);
      expect(f.screen.children.indexOf(panel)).toBeLessThan(f.screen.children.indexOf(shield));
      expect(f.screen.focused).toBe(topDialog);
      placeBelowDialogs(f.screen, panel); // Idempotent for content already below dialogs.
      expect(f.screen.children.indexOf(panel)).toBeLessThan(f.screen.children.indexOf(shield));
      second.close();
      first.close();
      const order = [...f.screen.children];
      placeBelowDialogs(f.screen, panel);
      expect(f.screen.children).toEqual(order);
    } finally { f.dispose(); }
  });

  it('retains the shield after Esc until allocation settles, then restores focus', () => {
    const f = fixture();
    try {
      const progress = showBulkLaunchProgress(f.screen, getTheme('midnight'), 16);
      expect(isDialogActive()).toBe(true);
      progress.update(3);
      expect(f.screen.focused.getContent()).toContain('Started 3 of 16');
      f.input.write('\u001b');
      // A direct key event avoids Blessed waiting to distinguish a bare Esc
      // from an escape sequence; parser shielding is exercised with CR below.
      f.screen.emit('keypress', undefined, { name: 'escape', full: 'escape' });
      expect(progress.cancelled).toBe(true);
      expect(isDialogActive()).toBe(true);
      expect(f.screen.focused.getContent()).toContain('Stopping remaining');
      f.input.write('\r');
      expect(f.leaked).toEqual([]);
      progress.close();
      progress.close();
      expect(isDialogActive()).toBe(false);
      expect(f.screen.focused).toBe(f.terminal);
    } finally { f.dispose(); }
  });

  it.each(['cancel', 'destroy'])('marks a pending batch cancelled on screen %s and tolerates later cleanup', action => {
    const f = fixture();
    try {
      const progress = showBulkLaunchProgress(f.screen, getTheme('midnight'), 20);
      if (action === 'destroy') f.screen.destroy();
      else closeDialogsForScreen(f.screen);
      expect(progress.cancelled).toBe(true);
      expect(isDialogActive()).toBe(false);
      expect(() => { progress.update(4); progress.close(); }).not.toThrow();
    } finally { f.dispose(); }
  });
});
