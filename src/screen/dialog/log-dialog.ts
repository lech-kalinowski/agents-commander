import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';
import { LOG_FILE, readLogTail } from '../../utils/logger.js';

let logOpen = false;

export function showLogDialog(screen: blessed.Widgets.Screen, theme: Theme): void {
  if (logOpen) return;
  logOpen = true;
  enterDialog(screen);

  let content = '';
  try {
    const tail = readLogTail();
    if (tail === null) {
      content = `No log file found at:\n${LOG_FILE}`;
    } else {
      content = tail;
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
    tags: false,
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
  let unregisterCancellation = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    logOpen = false;
    unregisterCancellation();
    leaveDialog(screen);
    screen.removeListener('keypress', onScreenKey);
    dialog.destroy();
    screen.render();
  };
  unregisterCancellation = registerDialogCancellation(screen, close);

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
