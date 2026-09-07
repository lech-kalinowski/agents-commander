import blessed from 'blessed';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showHelpDialog } from '../../src/screen/dialog/help-dialog.js';
import { showProtocolGuide } from '../../src/screen/dialog/protocol-dialog.js';
import { showLogDialog } from '../../src/screen/dialog/log-dialog.js';
import { showActivityDialog } from '../../src/screen/dialog/activity-dialog.js';
import { closeDialogsForScreen, isDialogActive } from '../../src/utils/dialog-state.js';

vi.mock('../../src/utils/logger.js', () => ({
  LOG_FILE: '/synthetic/log', readLogTail: () => 'Synthetic log only',
}));

const dialogs = [
  { name: 'Help', key: 'f1', bytes: '\x1bOP', open: showHelpDialog },
  { name: 'Logs', key: 'C-l', bytes: '\x0c', open: showLogDialog },
  { name: 'Protocol', key: 'S-f12', bytes: '\x1b[24;2~', open: showProtocolGuide },
  { name: 'Activity', key: 'f12', bytes: '\x1b[24~',
    open: (screen: blessed.Widgets.Screen) => showActivityDialog(screen, getTheme('midnight'), () => []),
  },
];

function fixture(open: typeof showHelpDialog, key: string) {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const terminal = blessed.box({ parent: screen, keys: true, input: true });
  const leakedKeys: string[] = [];
  terminal.on('keypress', (_ch: string, event: { name: string }) => {
    if (!isDialogActive()) leakedKeys.push(event.name);
  });
  terminal.focus();
  screen.key([key], () => { if (!isDialogActive()) open(screen, getTheme('midnight')); });
  return { input, screen, terminal, leakedKeys,
    async dispose() {
      closeDialogsForScreen(screen);
      await Promise.resolve();
      screen.destroy();
      input.destroy();
      output.destroy();
    },
  };
}

describe('real Blessed information dialog shortcuts', () => {
  it.each(dialogs)('$name toggles closed and reopens through its own shortcut', async ({ open, key, bytes }) => {
    const f = fixture(open, key);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        f.input.write(bytes);
        await Promise.resolve();
        expect(isDialogActive()).toBe(true);
        f.input.write(bytes);
        await Promise.resolve();
        expect(isDialogActive()).toBe(false);
        expect(f.screen.focused).toBe(f.terminal);
      }
    } finally {
      await f.dispose();
    }
  });

  it.each(dialogs.filter(({ name }) => name === 'Help' || name === 'Protocol'))(
    '$name contains both halves of CR when Enter closes it', async ({ open, key }) => {
      const f = fixture(open, key);
      try {
        open(f.screen, getTheme('midnight'));
        f.input.write('\r');
        await Promise.resolve();
        expect(isDialogActive()).toBe(false);
        expect(f.leakedKeys).toEqual([]);
      } finally {
        await f.dispose();
      }
    },
  );

  it.each(dialogs.filter(({ name }) => name !== 'Activity'))(
    '$name owner cancellation leaves an immediately reopened modal shield intact', async ({ open, key }) => {
      const f = fixture(open, key);
      try {
        open(f.screen, getTheme('midnight'));
        // q queues dismissal; owner cancellation must close synchronously.
        f.input.write('q');
        closeDialogsForScreen(f.screen);
        expect(isDialogActive()).toBe(false);
        open(f.screen, getTheme('midnight'));
        const replacement = f.screen.focused;
        await Promise.resolve();
        expect(isDialogActive()).toBe(true);
        expect(f.screen.focused).toBe(replacement);
        expect(f.leakedKeys).toEqual([]);
        f.input.write('q');
        await Promise.resolve();
        expect(isDialogActive()).toBe(false);
      } finally {
        await f.dispose();
      }
    },
  );
});
