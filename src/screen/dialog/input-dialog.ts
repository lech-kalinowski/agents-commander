import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';
import { bindOverlayResize, screenGeometry, truncateOverlayText } from './geometry.js';

export function showInputDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  title: string,
  prompt: string,
  defaultValue = '',
): Promise<string | null> {
  return new Promise((resolve) => {
    enterDialog();
    const safePrompt = truncateOverlayText(prompt, 300);
    const geometry = screenGeometry(screen, 50, 8);
    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: geometry.width,
      height: geometry.height,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: theme.dialog.border,
      },
      tags: true,
      label: ` ${title} `,
      shadow: true,
    });

    blessed.text({
      parent: dialog,
      top: 1,
      left: 2,
      width: '100%-6',
      tags: false,
      content: safePrompt,
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const input = blessed.textbox({
      parent: dialog,
      top: 3,
      left: 2,
      width: '100%-6',
      height: 1,
      style: {
        bg: 'black',
        fg: 'white',
        focus: { bg: 'black', fg: 'white' },
      },
      inputOnFocus: true,
      value: defaultValue,
    });

    blessed.text({
      parent: dialog,
      top: 5,
      left: 'center',
      content: 'Enter=OK  Esc=Cancel',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const unbindResize = bindOverlayResize(screen, dialog, 50, 8);

    const cleanup = () => {
      leaveDialog();
      unbindResize();
      dialog.destroy();
      screen.render();
    };

    input.on('submit', (value: string) => {
      cleanup();
      resolve(value || null);
    });

    input.on('cancel', () => {
      cleanup();
      resolve(null);
    });

    input.focus();
    screen.render();
  });
}
