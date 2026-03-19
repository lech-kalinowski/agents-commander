import blessed from 'blessed';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';

const LOG_FILE = path.join(os.homedir(), '.agents-commander', 'debug.log');

let logOpen = false;

export function showLogDialog(screen: blessed.Widgets.Screen, theme: Theme): void {
  if (logOpen) return;
  logOpen = true;
  enterDialog();

  let content = '';
  try {
    if (fs.existsSync(LOG_FILE)) {
      const raw = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = raw.split('\n');
      const tail = lines.slice(-200);
      content = tail.join('\n');
    } else {
      content = `No log file found at:\n${LOG_FILE}`;
    }
  } catch (err) {
    content = `Error reading log: ${(err as Error).message}`;
  }

  const dialog = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    border: { type: 'line' },
    style: {
      bg: 'black',
      fg: 'white',
      border: { fg: 'cyan' },
    },
    tags: true,
    label: ` Logs: ${LOG_FILE} `,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { style: { bg: 'cyan' } },
    mouse: true,
    content,
  });

  // Status line
  blessed.box({
    parent: dialog,
    bottom: 0,
    left: 0,
    width: '100%-2',
    height: 1,
    tags: true,
    style: { bg: 'cyan', fg: 'black' },
    content: ' Esc/q/Ctrl+L=Close  PgUp/PgDn=Scroll ',
  });

  // Scroll to bottom
  dialog.setScrollPerc(100);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    logOpen = false;
    leaveDialog();
    screen.removeListener('keypress', onScreenKey);
    dialog.destroy();
    screen.render();
  };

  // Manual scroll keys
  dialog.key(['up'], () => { dialog.scroll(-1); screen.render(); });
  dialog.key(['down'], () => { dialog.scroll(1); screen.render(); });
  dialog.key(['pageup'], () => { dialog.scroll(-((dialog.height as number) - 4)); screen.render(); });
  dialog.key(['pagedown'], () => { dialog.scroll((dialog.height as number) - 4); screen.render(); });

  // Close on dialog-level keys
  dialog.key(['escape', 'q', 'C-l'], close);

  // Screen-level fallback
  const onScreenKey = (_ch: any, key: any) => {
    if (!key) return;
    const name = key.full || key.name;
    if (name === 'escape' || name === 'q' || name === 'C-l') {
      close();
    }
  };
  screen.on('keypress', onScreenKey);

  dialog.focus();
  screen.render();
}
