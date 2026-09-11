import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog, registerDialogCancellation } from '../../utils/dialog-state.js';
import { bindOverlayResize, screenGeometry } from './geometry.js';

export interface ProtocolBatchProgress {
  readonly cancelled: boolean;
  /** currentPanel is a zero-based stable panel ID, rendered as P(id + 1). */
  update(completed: number, submitted: number, skipped: number, failed: number, currentPanel?: number): void;
  close(): void;
}

/** Esc stops scheduling; the caller closes the shield after its current step settles. */
export function showProtocolBatchProgress(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  total: number,
): ProtocolBatchProgress {
  const previousGrabKeys = screen.grabKeys;
  let entered = false;
  let closed = false;
  let cancelled = false;
  let completed = 0;
  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  let currentPanel: number | undefined;
  let screenKeyBound = false;
  let focusBound = false;
  let unregister = () => {};
  let unbindResize = () => {};
  let dialog: blessed.Widgets.BoxElement | undefined;

  const keepFocus = () => {
    if (!closed && dialog && screen.focused !== dialog) dialog.focus();
  };
  const cancel = () => {
    if (closed || cancelled) return;
    cancelled = true;
    render();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    if (screenKeyBound) screen.unkey(['escape'], cancel);
    if (focusBound) screen.removeListener('element focus', keepFocus);
    unregister();
    unbindResize();
    screen.grabKeys = previousGrabKeys;
    try {
      dialog?.destroy();
    } finally {
      if (entered) leaveDialog(screen);
    }
    if (!(screen as blessed.Widgets.Screen & { destroyed?: boolean }).destroyed) screen.render();
  };
  const fail = (error: unknown): never => {
    cancelled = true;
    try { close(); } catch { /* Preserve the original error after releasing modal state. */ }
    throw error;
  };
  function render(): void {
    if (closed || !dialog) return;
    try {
      dialog.setContent(
        `Completed ${completed} of ${total} panels.\n`
        + `Submitted: ${submitted}  Skipped: ${skipped}  Failed: ${failed}\n`
        + (currentPanel === undefined ? '' : `Current panel: P${currentPanel + 1}\n`)
        + '\n'
        + (cancelled ? 'Stopping remaining submissions…' : 'Esc: stop remaining submissions')
        + '\nAlready submitted protocol is kept.',
      );
      dialog.setFront();
      dialog.focus();
      screen.render();
    } catch (error) {
      fail(error);
    }
  }

  try {
    enterDialog(screen);
    entered = true;
    const geometry = screenGeometry(screen, 66, 11);
    dialog = blessed.box({
      parent: screen, top: 'center', left: 'center',
      width: geometry.width, height: geometry.height,
      border: { type: 'line' }, label: ' Sending Commander Protocol ',
      style: { bg: theme.dialog.bg, fg: theme.dialog.fg, border: theme.dialog.border },
      tags: false, keys: true, mouse: true, clickable: true,
      padding: { left: 1, right: 1, top: 1 },
    });
    // Grab ordinary keys before app shortcuts and keep asynchronously focused
    // background panels from becoming the recipient of terminal input.
    screen.grabKeys = true;
    dialog.key(['escape'], cancel);
    screen.key(['escape'], cancel);
    screenKeyBound = true;
    screen.on('element focus', keepFocus);
    focusBound = true;
    unregister = registerDialogCancellation(screen, () => { cancelled = true; close(); });
    unbindResize = bindOverlayResize(screen, dialog, 66, 11, render);
    return {
      get cancelled() { return cancelled; },
      update(nextCompleted, nextSubmitted, nextSkipped, nextFailed, nextPanel) {
        completed = nextCompleted;
        submitted = nextSubmitted;
        skipped = nextSkipped;
        failed = nextFailed;
        currentPanel = nextPanel;
        render();
      },
      close,
    };
  } catch (error) {
    return fail(error);
  }
}
