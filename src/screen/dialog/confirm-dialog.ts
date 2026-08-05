import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';
import { bindOverlayResize, screenGeometry, truncateOverlayText } from './geometry.js';

export interface ConfirmDialogController {
  /** Confirm the dialog through a trusted external input source. */
  confirm(): void;
  /** Cancel the dialog through a trusted external input source. */
  cancel(): void;
  isOpen(): boolean;
}

export interface ConfirmDialogOptions {
  onReady?: (controller: ConfirmDialogController) => void;
  /** Only controller.confirm() may approve; terminal keys remain cancellation-only. */
  externalConfirmOnly?: boolean;
}

export function showConfirmDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  title: string,
  message: string,
  options: ConfirmDialogOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const externalConfirmOnly = options.externalConfirmOnly === true;
    enterDialog(screen);

    const safeMessage = truncateOverlayText(message, 500);
    const preferredWidth = Math.max(44, Math.min(72, safeMessage.length + 6));
    const preferredHeight = Math.min(
      11,
      7 + Math.floor(safeMessage.length / Math.max(1, preferredWidth - 6)),
    );
    const geometry = screenGeometry(screen, preferredWidth, preferredHeight);
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
      keys: true,
    });

    const messageBox = blessed.text({
      parent: dialog,
      top: 1,
      left: 2,
      width: '100%-6',
      height: '100%-5',
      align: 'center',
      wrap: true,
      tags: false,
      content: safeMessage,
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    // ── Yes / No buttons ──
    let selected = false; // false = "No" selected by default (safer)

    const btnWidth = 12;
    const yesBtn = blessed.box({
      parent: dialog,
      bottom: 1,
      left: Math.max(1, Math.floor(geometry.width / 2) - btnWidth - 2),
      width: btnWidth,
      height: 1,
      tags: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const noBtn = blessed.box({
      parent: dialog,
      bottom: 1,
      left: Math.max(15, Math.floor(geometry.width / 2) + 2),
      width: btnWidth,
      height: 1,
      tags: true,
      content: '',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
    });

    const unbindResize = bindOverlayResize(
      screen,
      dialog,
      preferredWidth,
      preferredHeight,
      (nextGeometry) => {
        messageBox.width = '100%-6';
        messageBox.height = '100%-5';
        yesBtn.left = Math.max(1, Math.floor(nextGeometry.width / 2) - btnWidth - 2);
        noBtn.left = Math.max(15, Math.floor(nextGeometry.width / 2) + 2);
      },
    );

    function renderButtons(): void {
      if (externalConfirmOnly) {
        yesBtn.setContent('{gray-fg} [ Device ] {/gray-fg}');
        noBtn.setContent('{cyan-bg}{black-fg}  [  No  ] {/black-fg}{/cyan-bg}');
        screen.render();
        return;
      }
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
    let unregisterCancellation = () => {};
    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      // Blessed emits a CR twice: first as synthetic `enter`, then as the
      // original `return`. Keep the modal shield and focus in place until the
      // complete synchronous key dispatch unwinds, otherwise the second event
      // can leak into the terminal restored beneath this dialog.
      queueMicrotask(() => {
        try {
          unregisterCancellation();
          leaveDialog(screen);
          unbindResize();
          dialog.destroy();
          screen.render();
        } finally {
          resolve(result);
        }
      });
    };
    unregisterCancellation = registerDialogCancellation(screen, () => finish(false));

    const controller: ConfirmDialogController = {
      confirm: () => finish(true),
      cancel: () => finish(false),
      isOpen: () => !resolved,
    };
    options.onReady?.(controller);

    dialog.key(['left', 'right', 'tab'], () => {
      if (externalConfirmOnly) return;
      selected = !selected;
      renderButtons();
    });

    // Consume arrow keys so they don't propagate to screen-level handlers
    dialog.key(['up', 'down'], () => { /* swallow */ });

    dialog.key(['y', 'Y'], () => {
      if (!externalConfirmOnly) finish(true);
    });
    dialog.key(['n', 'N', 'escape'], () => finish(false));
    dialog.key(['enter', 'return'], () => finish(
      externalConfirmOnly ? false : selected,
    ));

    dialog.focus();
    screen.render();
  });
}
