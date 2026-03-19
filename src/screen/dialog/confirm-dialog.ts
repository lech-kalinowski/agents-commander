import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';

export function showConfirmDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  title: string,
  message: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    enterDialog();

    const dialogWidth = Math.max(44, message.length + 6);
    const dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: dialogWidth,
      height: 7,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: theme.dialog.border,
      },
      tags: true,
      label: ` ${title} `,
      shadow: true,
      keys: true,
    });

    blessed.text({
      parent: dialog,
      top: 1,
      left: 'center',
      content: message,
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── Yes / No buttons ──
    let selected = false; // false = "No" selected by default (safer)

    const btnWidth = 12;
    const yesBtn = blessed.box({
      parent: dialog,
      top: 3,
      left: Math.floor(dialogWidth / 2) - btnWidth - 2,
      width: btnWidth,
      height: 1,
      tags: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const noBtn = blessed.box({
      parent: dialog,
      top: 3,
      left: Math.floor(dialogWidth / 2) + 2,
      width: btnWidth,
      height: 1,
      tags: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    function renderButtons(): void {
      if (selected) {
        yesBtn.setContent('{cyan-bg}{black-fg}  [ Yes ]  {/black-fg}{/cyan-bg}');
        noBtn.setContent('     No     ');
      } else {
        yesBtn.setContent('    Yes     ');
        noBtn.setContent('{cyan-bg}{black-fg}  [  No  ] {/black-fg}{/cyan-bg}');
      }
      screen.render();
    }

    renderButtons();

    let resolved = false;
    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      leaveDialog();
      dialog.destroy();
      screen.render();
      resolve(result);
    };

    dialog.key(['left', 'right', 'tab'], () => {
      selected = !selected;
      renderButtons();
    });

    // Consume arrow keys so they don't propagate to screen-level handlers
    dialog.key(['up', 'down'], () => { /* swallow */ });

    dialog.key(['y', 'Y'], () => finish(true));
    dialog.key(['n', 'N', 'escape'], () => finish(false));
    dialog.key(['enter'], () => finish(selected));

    dialog.focus();
    screen.render();
  });
}
