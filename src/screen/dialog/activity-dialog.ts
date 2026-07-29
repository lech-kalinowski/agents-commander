import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import type { MessageRecord } from '../../orchestration/message-ledger.js';
import { enterDialog, leaveDialog } from '../../utils/dialog-state.js';
import { bindOverlayResize, truncateOverlayText } from './geometry.js';

const DEFAULT_LIMIT = 100;
const DEFAULT_REFRESH_INTERVAL_MS = 1000;
const ROUTED_KINDS = new Set(['send', 'reply', 'broadcast']);

export type ActivityProvider = (limit: number) => readonly MessageRecord[];

export interface ActivityDialogOptions {
  limit?: number;
  refreshIntervalMs?: number;
}

export interface ActivityDialogHandle {
  close(): void;
  refresh(): void;
}

let activityOpen = false;

function safeText(value: unknown, maxLength: number, fallback = 'unknown'): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return truncateOverlayText(text, maxLength) || fallback;
}

function panelLabel(panelIndex: number | null): string {
  if (
    typeof panelIndex !== 'number' ||
    !Number.isFinite(panelIndex) ||
    panelIndex < 0
  ) {
    return 'P?';
  }
  return `P${Math.floor(panelIndex) + 1}`;
}

function timeLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '--:--:--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function routedMessages(records: readonly MessageRecord[]): MessageRecord[] {
  return records.filter((record) => ROUTED_KINDS.has(record.kind));
}

export function formatRoutedActivity(
  records: readonly MessageRecord[],
  availableWidth = 100,
): string {
  const messages = routedMessages(records);
  const lineLength = Math.max(24, Math.min(180, Math.floor(availableWidth) - 6));

  if (messages.length === 0) {
    return [
      'No routed messages yet.',
      '',
      'This view records SEND, REPLY, and BROADCAST delivery attempts.',
      'STATUS and QUERY are live-only and are not included.',
    ].join('\n');
  }

  const lines = [
    `Routed messages only: SEND, REPLY, BROADCAST. Newest first (${messages.length}).`,
    '',
  ];

  for (const record of messages) {
    const sourceName = safeText(record.source.agentName, 36);
    const targetName = safeText(
      record.target.agentName ?? record.target.agentType,
      36,
    );
    const status = safeText(record.status, 14).toUpperCase();
    const kind = safeText(record.kind, 12).toUpperCase();
    const content = safeText(record.content, Math.min(240, lineLength * 2), '(empty)');
    const messageId = safeText(record.messageId, 48);
    const threadId = safeText(record.threadId, 48);

    lines.push(
      safeText(
        `${timeLabel(record.updatedAt)}  ${status.padEnd(9)} ${kind}`,
        lineLength,
      ),
      safeText(
        `${panelLabel(record.source.panelIndex)} ${sourceName} -> ` +
        `${panelLabel(record.target.panelIndex)} ${targetName}`,
        lineLength,
      ),
      safeText(content, lineLength),
      safeText(`thread ${threadId}  |  message ${messageId}`, lineLength),
    );

    if (record.error) {
      lines.push(safeText(`error: ${record.error}`, lineLength));
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function showActivityDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  getActivity: ActivityProvider,
  options: ActivityDialogOptions = {},
): ActivityDialogHandle | null {
  if (activityOpen) return null;
  activityOpen = true;

  const previousFocus = screen.focused;
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT))
    : DEFAULT_LIMIT;
  const refreshIntervalMs = Number.isFinite(options.refreshIntervalMs)
    ? Math.max(100, Math.trunc(options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS))
    : DEFAULT_REFRESH_INTERVAL_MS;
  let dialog: blessed.Widgets.BoxElement | null = null;
  let unbindResize: (() => void) | null = null;
  let onScreenKey: ((_ch: unknown, key: any) => void) | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let keyListenerAttached = false;
  let dialogStateEntered = false;
  let closed = false;
  let lastContent = '';

  const close = () => {
    if (closed) return;
    closed = true;
    activityOpen = false;
    const cleanupErrors: unknown[] = [];
    const cleanupStep = (step: () => void) => {
      try {
        step();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (keyListenerAttached && onScreenKey) {
      cleanupStep(() => screen.removeListener('keypress', onScreenKey!));
      keyListenerAttached = false;
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
      cleanupStep(leaveDialog);
      dialogStateEntered = false;
    }

    const focusTarget = previousFocus as { destroyed?: boolean; focus?: () => void } | null;
    if (focusTarget && !focusTarget.destroyed && typeof focusTarget.focus === 'function') {
      cleanupStep(() => focusTarget.focus!());
    }
    cleanupStep(() => screen.render());

    if (cleanupErrors.length > 0) {
      throw cleanupErrors[0];
    }
  };

  try {
    enterDialog();
    dialogStateEntered = true;

    dialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 100,
      height: 32,
      border: { type: 'line' },
      style: {
        bg: theme.dialog.bg,
        fg: theme.dialog.fg,
        border: { fg: 'cyan' },
      },
      tags: false,
      label: ' Routed Message Activity — SEND / REPLY / BROADCAST (F12) ',
      shadow: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        style: { bg: 'cyan' },
      },
      mouse: true,
      content: '',
    });

    blessed.text({
      parent: dialog,
      bottom: 0,
      left: 'center',
      tags: false,
      content: ' Esc/q/F12 = Close    Up/Down/PgUp/PgDn = Scroll    Live refresh ',
      style: { bg: theme.dialog.bg, fg: 'cyan' },
    });

    const refresh = () => {
      if (closed || !dialog) return;
      const previousScroll = dialog.getScroll();
      let content: string;
      try {
        content = formatRoutedActivity(
          getActivity(limit),
          typeof dialog.width === 'number' ? dialog.width : 100,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        content = `Routed-message activity is unavailable: ${safeText(message, 180)}`;
      }

      if (content !== lastContent) {
        lastContent = content;
        dialog.setContent(content);
        dialog.setScroll(previousScroll);
      }
      screen.render();
    };

    unbindResize = bindOverlayResize(
      screen,
      dialog,
      100,
      32,
      refresh,
      { minWidth: 44, minHeight: 10 },
    );

    const isPlainF12 = (key: any): boolean => (
      (key?.full === 'f12' || (!key?.full && key?.name === 'f12')) &&
      !key?.shift
    );

    onScreenKey = (_ch: unknown, key: any) => {
      if (!key) return;
      const name = key.full || key.name;
      if (name === 'escape' || name === 'q') {
        close();
      } else if (isPlainF12(key)) {
        queueMicrotask(close);
      }
    };

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
    currentDialog.key(['escape', 'q', 'f12'], close);

    screen.on('keypress', onScreenKey);
    keyListenerAttached = true;
    refreshTimer = setInterval(refresh, refreshIntervalMs);
    refreshTimer.unref?.();

    dialog.focus();
    screen.render();

    return { close, refresh };
  } catch (error) {
    try {
      close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Activity dialog setup failed and cleanup also reported an error',
      );
    }
    throw error;
  }
}
