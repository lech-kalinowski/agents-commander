import blessed from 'blessed';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showPanelNavigatorDialog } from '../../src/screen/dialog/panel-navigator-dialog.js';
import { closeDialogsForScreen, isDialogActive } from '../../src/utils/dialog-state.js';

function fixture() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const terminal = blessed.box({ parent: screen, keys: true, input: true });
  const leakedKeys: string[] = [];
  terminal.on('keypress', (_ch: string, key: { name: string }) => {
    if (!isDialogActive()) leakedKeys.push(key.name);
  });
  terminal.focus();
  let decision: Promise<number | null> | undefined;
  const open = () => {
    decision = showPanelNavigatorDialog(screen, getTheme('midnight'), [{
      panelId: 99, panelNumber: 100, title: 'Synthetic panel', kind: 'files',
      status: 'visible', cwd: '/synthetic-panel',
    }], 99);
    return decision;
  };
  screen.key(['f11'], () => { if (!isDialogActive()) open(); });
  return { input, screen, terminal, leakedKeys, open, decision: () => decision!,
    async dispose() {
      closeDialogsForScreen(screen);
      await decision;
      screen.destroy();
      input.destroy();
      output.destroy();
    },
  };
}

describe('real Blessed panel navigator input ownership', () => {
  it('can reopen via F11 after a previous selection instead of closing on its opening key', async () => {
    const f = fixture();
    try {
      f.input.write('\x1b[23~');
      expect(isDialogActive()).toBe(true);
      f.input.write('\r');
      await expect(f.decision()).resolves.toBe(99);
      f.input.write('\x1b[23~');
      await Promise.resolve();
      expect(isDialogActive()).toBe(true);
      f.input.write('\x1b[23~');
      await expect(f.decision()).resolves.toBeNull();
      expect(isDialogActive()).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it('contains both Enter and Return events from one physical CR', async () => {
    const f = fixture();
    try {
      const decision = f.open();
      f.input.write('\r');
      await expect(decision).resolves.toBe(99);
      expect(f.leakedKeys).toEqual([]);
      expect(f.screen.focused).toBe(f.terminal);
      expect(isDialogActive()).toBe(false);
    } finally {
      await f.dispose();
    }
  });

  it('freezes queued selection and shields keys until dispatch has completed', async () => {
    const f = fixture();
    try {
      const decision = f.open();
      f.input.write('\rnot-a-panel\x1b[B\r');
      expect(isDialogActive()).toBe(true);
      await expect(decision).resolves.toBe(99);
      expect(f.leakedKeys).toEqual([]);
    } finally {
      await f.dispose();
    }
  });

  it('lets owner cancellation override queued selection and immediately reopen safely', async () => {
    const f = fixture();
    try {
      const first = f.open();
      f.input.write('\r');
      closeDialogsForScreen(f.screen);
      const second = f.open();
      const secondInput = f.screen.focused;
      await expect(first).resolves.toBeNull();
      expect(isDialogActive()).toBe(true);
      expect(f.screen.focused).toBe(secondInput);
      closeDialogsForScreen(f.screen);
      await expect(second).resolves.toBeNull();
      expect(isDialogActive()).toBe(false);
      expect(f.leakedKeys).toEqual([]);
    } finally {
      await f.dispose();
    }
  });
});
