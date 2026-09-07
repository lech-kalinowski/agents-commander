import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog, registerDialogCancellation } from '../../utils/dialog-state.js';
import { bindOverlayResize, screenGeometry } from './geometry.js';

export interface BulkLaunchProgress {
  readonly cancelled: boolean;
  update(started: number): void;
  close(): void;
}

/** Esc stops scheduling, but the shield stays until the in-flight step settles. */
export function showBulkLaunchProgress(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  total: number,
): BulkLaunchProgress {
  enterDialog(screen);
  let closed = false;
  let cancelled = false;
  let started = 0;
  let unregister = () => {};
  let unbindResize = () => {};
  let dialog: blessed.Widgets.BoxElement | undefined;

  const cancel = () => {
    if (closed) return;
    cancelled = true;
    render();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    screen.unkey(['escape'], cancel);
    unregister();
    unbindResize();
    dialog?.destroy();
    leaveDialog(screen);
    if (!(screen as blessed.Widgets.Screen & { destroyed?: boolean }).destroyed) screen.render();
  };
  function render(): void {
    if (closed || !dialog) return;
    dialog.setContent(
      `Started ${started} of ${total} new CLI processes.\n\n`
      + (cancelled ? 'Stopping remaining launches…' : 'Esc: stop remaining launches')
      + '\nAlready started sessions are kept.\nProvider readiness is not yet verified.',
    );
    dialog.setFront();
    dialog.focus();
    screen.render();
  }

  try {
    const geometry = screenGeometry(screen, 62, 10);
    dialog = blessed.box({
      parent: screen, top: 'center', left: 'center',
      width: geometry.width, height: geometry.height,
      border: { type: 'line' }, label: ' Launching new terminals ',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg, border: theme.dialog.border },
      tags: false, keys: true, mouse: true, clickable: true,
      padding: { left: 1, right: 1, top: 1 },
    });
    // Screen-scoped input remains cancellable even if a layout load changes focus.
    screen.key(['escape'], cancel);
    unregister = registerDialogCancellation(screen, () => { cancelled = true; close(); });
    unbindResize = bindOverlayResize(screen, dialog, 62, 10, render);
    render();
    return {
      get cancelled() { return cancelled; },
      update(count) { started = count; render(); },
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
