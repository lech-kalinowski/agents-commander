import blessed from 'blessed';

/**
 * Shared modal state. Besides guarding app shortcuts, a screen-scoped entry
 * installs a transparent mouse shield, remembers focus, and can be cancelled
 * deterministically when its owning App or Blessed screen is disposed.
 */
let depth = 0;

interface FocusTarget {
  destroyed?: boolean;
  detached?: boolean;
  focus?: () => void;
}

interface DialogEntry {
  shield: blessed.Widgets.BoxElement;
  previousFocus: FocusTarget | null;
  cancel: (() => void) | null;
  closing: boolean;
}

const dialogsByScreen = new WeakMap<blessed.Widgets.Screen, DialogEntry[]>();
const observedScreens = new WeakSet<blessed.Widgets.Screen>();

function stackFor(screen: blessed.Widgets.Screen): DialogEntry[] {
  let stack = dialogsByScreen.get(screen);
  if (!stack) {
    stack = [];
    dialogsByScreen.set(screen, stack);
  }
  return stack;
}

function restoreFocus(target: FocusTarget | null): void {
  if (
    !target
    || target.destroyed
    || target.detached
    || typeof target.focus !== 'function'
  ) return;
  try {
    target.focus();
  } catch {
    // Focus restoration is best-effort during screen teardown.
  }
}

function releaseEntry(screen: blessed.Widgets.Screen, entry: DialogEntry): void {
  const stack = dialogsByScreen.get(screen);
  const index = stack?.lastIndexOf(entry) ?? -1;
  if (index < 0) return;
  stack!.splice(index, 1);
  depth = Math.max(0, depth - 1);
  try {
    entry.shield.destroy();
  } catch {
    // The screen may already be destroying its descendants.
  }
  restoreFocus(entry.previousFocus);
  if (stack!.length === 0) dialogsByScreen.delete(screen);
}

export function enterDialog(screen?: blessed.Widgets.Screen): void {
  if (!screen) {
    depth++;
    return;
  }

  const previousFocus = screen.focused as FocusTarget | null;
  const shield = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    mouse: true,
    keys: false,
    transparent: true,
    autoFocus: false,
  });
  stackFor(screen).push({
    shield,
    previousFocus,
    cancel: null,
    closing: false,
  });
  depth++;

  if (!observedScreens.has(screen)) {
    observedScreens.add(screen);
    const observeDestroy = (screen as blessed.Widgets.Screen & {
      once?: (event: string, listener: () => void) => unknown;
    }).once;
    observeDestroy?.call(screen, 'destroy', () => {
      closeDialogsForScreen(screen);
    });
  }
}

export function leaveDialog(screen?: blessed.Widgets.Screen): void {
  if (!screen) {
    depth = Math.max(0, depth - 1);
    return;
  }
  const entry = dialogsByScreen.get(screen)?.at(-1);
  if (entry) releaseEntry(screen, entry);
}

/** Register the cancellation path for the most recently entered modal. */
export function registerDialogCancellation(
  screen: blessed.Widgets.Screen,
  cancel: () => void,
): () => void {
  const entry = dialogsByScreen.get(screen)?.at(-1);
  if (!entry) return () => {};
  entry.cancel = cancel;
  return () => {
    if (entry.cancel === cancel) entry.cancel = null;
  };
}

/** Close every modal owned by one screen, newest first. */
export function closeDialogsForScreen(screen: blessed.Widgets.Screen): void {
  const stack = dialogsByScreen.get(screen);
  while (stack && stack.length > 0) {
    const entry = stack.at(-1)!;
    if (entry.closing) {
      releaseEntry(screen, entry);
      continue;
    }
    entry.closing = true;
    try {
      entry.cancel?.();
    } catch {
      // Disposal must continue even when a dialog-specific close hook fails.
    }
    if (stack.includes(entry)) releaseEntry(screen, entry);
  }
}

export function isDialogActive(): boolean { return depth > 0; }
