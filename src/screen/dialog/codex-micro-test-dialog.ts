import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import {
  CODEX_MICRO_BINDINGS,
  getCodexMicroAction,
  type CodexMicroAction,
} from '../../hardware/codex-micro.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';
import { bindOverlayResize } from './geometry.js';

const CODEX_MICRO_ACTIONS = new Set<CodexMicroAction>(
  CODEX_MICRO_BINDINGS.map((binding) => binding.action),
);

function displayKey(key: string): string {
  const parts = key.split('-');
  return parts.map((part) => {
    if (part === 'C') return 'Ctrl';
    if (part === 'S') return 'Shift';
    if (part === 'pageup') return 'Page Up';
    if (part === 'pagedown') return 'Page Down';
    if (/^f\d+$/i.test(part)) return part.toUpperCase();
    return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
  }).join('+');
}

export function formatCodexMicroTestContent(
  testedActions: ReadonlySet<CodexMicroAction>,
): string {
  const testedCount = CODEX_MICRO_BINDINGS.reduce(
    (count, binding) => count + Number(testedActions.has(binding.action)),
    0,
  );
  const status = testedCount === CODEX_MICRO_BINDINGS.length
    ? '{bold}{green-fg}All controls detected — ready for rehearsal.{/green-fg}{/bold}'
    : `{bold}Detected ${testedCount}/${CODEX_MICRO_BINDINGS.length} controls{/bold}`;
  const rows = CODEX_MICRO_BINDINGS.map((binding) => {
    const marker = testedActions.has(binding.action)
      ? '{green-fg}[✓]{/green-fg}'
      : '{gray-fg}[ ]{/gray-fg}';
    return `  ${marker} ${displayKey(binding.key).padEnd(22)} ${binding.label}`;
  });

  return [
    '{bold}{cyan-fg}CODEX MICRO CONTROL TEST{/cyan-fg}{/bold}',
    'Press each programmed control. A check means its semantic action reached Commander.',
    'This validates keyboard shortcuts, not physical device identity or connection quality.',
    '',
    status,
    '',
    ...rows,
  ].join('\n');
}

export interface CodexMicroTestDialogHandle {
  /** Mark one semantic action as received while the checklist is open. */
  recordAction(action: CodexMicroAction): boolean;
  reset(): void;
  close(): void;
  isOpen(): boolean;
  testedActions(): readonly CodexMicroAction[];
}

let activeDialog: CodexMicroTestDialogHandle | null = null;

export function showCodexMicroTestDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
): CodexMicroTestDialogHandle {
  if (activeDialog?.isOpen()) return activeDialog;

  const tested = new Set<CodexMicroAction>();
  let dialog: blessed.Widgets.BoxElement | null = null;
  let unbindResize: (() => void) | null = null;
  let screenKeyAttached = false;
  let dialogStateEntered = false;
  let unregisterCancellation = () => {};
  let closed = false;

  const renderContent = () => {
    if (closed || !dialog) return;
    const previousScroll = dialog.getScroll();
    dialog.setContent(formatCodexMicroTestContent(tested));
    dialog.setScroll(previousScroll);
    screen.render();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (activeDialog === handle) activeDialog = null;
    unregisterCancellation();

    const cleanupErrors: unknown[] = [];
    const cleanupStep = (step: () => void) => {
      try {
        step();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };

    if (screenKeyAttached) {
      cleanupStep(() => screen.removeListener('keypress', onScreenKey));
      screenKeyAttached = false;
    }
    if (unbindResize) {
      cleanupStep(unbindResize);
      unbindResize = null;
    }
    if (dialog) {
      cleanupStep(() => dialog!.destroy());
      dialog = null;
    }
    if (dialogStateEntered) {
      cleanupStep(() => leaveDialog(screen));
      dialogStateEntered = false;
    }
    cleanupStep(() => screen.render());

    if (cleanupErrors.length > 0) throw cleanupErrors[0];
  };

  const reset = () => {
    if (closed) return;
    tested.clear();
    if (dialog) dialog.setScroll(0);
    renderContent();
  };

  const recordAction = (action: CodexMicroAction): boolean => {
    if (closed || !CODEX_MICRO_ACTIONS.has(action)) return false;
    tested.add(action);
    renderContent();
    return true;
  };

  const handle: CodexMicroTestDialogHandle = {
    recordAction,
    reset,
    close,
    isOpen: () => !closed,
    testedActions: () => CODEX_MICRO_BINDINGS
      .map((binding) => binding.action)
      .filter((action) => tested.has(action)),
  };

  const onScreenKey = (_ch: unknown, key: any) => {
    if (!key) return;
    const name = key.full || key.name;
    const action = typeof name === 'string' ? getCodexMicroAction(name) : undefined;
    if (action) {
      recordAction(action);
    } else if (
      name === 'escape'
      || name === 'q'
      || name === 'Q'
      || name === 'S-q'
      || (key.name === 'q' && key.shift)
    ) {
      close();
    } else if (
      name === 'r'
      || name === 'R'
      || name === 'S-r'
      || (key.name === 'r' && key.shift)
    ) {
      reset();
    }
  };

  try {
    enterDialog(screen);
    dialogStateEntered = true;
    unregisterCancellation = registerDialogCancellation(screen, close);

    dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 92,
      height: 24,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: { fg: 'cyan' },
      },
      tags: true,
      label: ' Codex Micro — Interactive Control Test ',
      shadow: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: 'cyan' } },
      mouse: true,
      content: '',
    });

    blessed.text({
      parent: dialog,
      bottom: 0,
      left: 'center',
      tags: false,
      content: ' R = Reset    Esc/Q = Close    Connect by USB-C for the stage rehearsal ',
      style: { bg: theme.dialog.bg, fg: 'cyan' },
    });

    const currentDialog = dialog;
    currentDialog.key(['up'], () => { currentDialog.scroll(-1); screen.render(); });
    currentDialog.key(['down'], () => { currentDialog.scroll(1); screen.render(); });
    currentDialog.key(['pageup'], () => {
      currentDialog.scroll(-Math.max(1, (currentDialog.height as number) - 4));
      screen.render();
    });
    currentDialog.key(['pagedown'], () => {
      currentDialog.scroll(Math.max(1, (currentDialog.height as number) - 4));
      screen.render();
    });
    currentDialog.key(['r', 'R'], reset);
    currentDialog.key(['escape', 'q', 'Q'], close);

    unbindResize = bindOverlayResize(
      screen,
      currentDialog,
      92,
      24,
      undefined,
      { minWidth: 44, minHeight: 12 },
    );
    screen.on('keypress', onScreenKey);
    screenKeyAttached = true;
    activeDialog = handle;
    renderContent();
    currentDialog.focus();

    return handle;
  } catch (error) {
    try {
      close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Codex Micro test dialog setup failed and cleanup also reported an error',
      );
    }
    throw error;
  }
}
