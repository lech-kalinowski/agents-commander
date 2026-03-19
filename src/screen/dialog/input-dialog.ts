import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';

export function showInputDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  title: string,
  prompt: string,
  defaultValue = '',
): Promise<string | null> {
  return new Promise((resolve) => {
    enterDialog();
    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 8,
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
      content: prompt,
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const input = blessed.textbox({
      parent: dialog,
      top: 3,
      left: 2,
      width: 44,
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

    const cleanup = () => {
      leaveDialog();
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
