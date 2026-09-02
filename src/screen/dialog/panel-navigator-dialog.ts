import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../../utils/dialog-state.js';
import {
  bindOverlayResize,
  screenGeometry,
  type OverlayGeometry,
} from './geometry.js';

const PREFERRED_WIDTH = 92;
const PREFERRED_HEIGHT = 26;
const MAX_QUERY_LENGTH = 200;

export interface PanelSummary {
  /** Stable protocol/session identity; never changes when panels move. */
  panelId: number;
  /** Stable user-facing protocol address (P-number). */
  panelNumber: number;
  /** Mutable one-based workspace order, independent of the P-number. */
  workspacePosition?: number;
  title: string;
  kind: string;
  status: string;
  cwd: string;
  agent?: string;
  model?: string;
  unreadCount?: number;
}

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchablePanelText(panel: PanelSummary): string {
  const unreadCount = Number.isFinite(panel.unreadCount)
    ? Math.max(0, Math.trunc(panel.unreadCount ?? 0))
    : 0;
  return normalizedText([
    panel.panelNumber,
    `p${panel.panelNumber}`,
    `panel ${panel.panelNumber}`,
    ...(panel.workspacePosition ? [`#${panel.workspacePosition}`, `position ${panel.workspacePosition}`] : []),
    panel.title,
    panel.kind,
    panel.status,
    panel.cwd,
    panel.agent,
    panel.model,
    unreadCount > 0 ? `unread ${unreadCount}` : '',
  ].join(' ')).toLocaleLowerCase();
}

/** Filter without mutating or reordering the input collection. */
export function filterPanelSummaries(
  panels: readonly PanelSummary[],
  query: string,
): PanelSummary[] {
  const normalizedQuery = normalizedText(query).toLocaleLowerCase();
  if (!normalizedQuery) return [...panels];

  const position = normalizedQuery.match(/^#(\d+)$/u);
  if (position) {
    return panels.filter((panel) => (panel.workspacePosition ?? panel.panelNumber) === Number(position[1]));
  }
  const directNumber = normalizedQuery.match(/^(?:p(?:anel)?\s*)?(\d+)$/u);
  if (directNumber) {
    const panelNumber = Number.parseInt(directNumber[1], 10);
    return panels.filter((panel) => panel.panelNumber === panelNumber);
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean);
  return panels.filter((panel) => {
    const searchable = searchablePanelText(panel);
    return tokens.every((token) => searchable.includes(token));
  });
}

/** Return a deterministic display order without mutating the input collection. */
export function sortPanelSummaries(
  panels: readonly PanelSummary[],
): PanelSummary[] {
  const panelNumber = (panel: PanelSummary): number => (
    Number.isFinite(panel.panelNumber) ? panel.panelNumber : Number.MAX_SAFE_INTEGER
  );
  return [...panels].sort((left, right) => (
    (left.workspacePosition ?? panelNumber(left)) - (right.workspacePosition ?? panelNumber(right))
    || panelNumber(left) - panelNumber(right)
    || normalizedText(left.title).localeCompare(normalizedText(right.title))
    || left.panelId - right.panelId
  ));
}

/** Format one safe, single-line list row bounded to the available width. */
export function formatPanelSummary(
  panel: PanelSummary,
  availableWidth = 86,
): string {
  const panelNumber = Number.isFinite(panel.panelNumber)
    ? Math.max(0, Math.trunc(panel.panelNumber))
    : 0;
  const unreadCount = Number.isFinite(panel.unreadCount)
    ? Math.max(0, Math.trunc(panel.unreadCount ?? 0))
    : 0;
  const title = normalizedText(panel.title) || '(untitled)';
  const details = [
    normalizedText(panel.kind),
    normalizedText(panel.status),
    normalizedText(panel.agent),
    normalizedText(panel.model),
  ].filter(Boolean).join(' · ');
  const cwd = normalizedText(panel.cwd);
  const unread = unreadCount > 0 ? ` unread:${unreadCount}` : '';
  const position = Number.isSafeInteger(panel.workspacePosition) && panel.workspacePosition! > 0
    ? `#${panel.workspacePosition} ` : '';
  const row = `${position}P${panelNumber}${unread}  ${title}${details ? `  [${details}]` : ''}`
    + `${cwd ? `  ${cwd}` : ''}`;
  const width = Number.isFinite(availableWidth)
    ? Math.max(1, Math.trunc(availableWidth))
    : 86;
  if (row.length <= width) return row;
  if (width === 1) return '…';
  return `${row.slice(0, width - 1)}…`;
}

let panelNavigatorOpen = false;

/**
 * Show a modal, searchable navigator and resolve with the selected stable
 * panelId. Search input is handled by the modal itself so it cannot leak to a
 * focused terminal process while the dialog is active.
 */
export function showPanelNavigatorDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  panels: readonly PanelSummary[],
  activePanelId?: number,
): Promise<number | null> {
  if (panelNavigatorOpen) return Promise.resolve(null);
  panelNavigatorOpen = true;

  enterDialog(screen);

  return new Promise<number | null>((resolve, reject) => {
    let dialog: blessed.Widgets.BoxElement | null = null;
    let input: blessed.Widgets.TextareaElement | null = null;
    let list: blessed.Widgets.ListElement | null = null;
    let footer: blessed.Widgets.TextElement | null = null;
    let unbindResize: (() => void) | null = null;
    let onScreenKey: ((ch: string | undefined, key: any) => void) | null = null;
    let onF11: (() => void) | null = null;
    let keyListenerAttached = false;
    let f11ListenerAttached = false;
    let dialogStateEntered = true;
    let unregisterCancellation = () => {};
    let closed = false;
    let query = '';
    let selectedIndex = 0;
    let currentGeometry = screenGeometry(
      screen,
      PREFERRED_WIDTH,
      PREFERRED_HEIGHT,
      { minWidth: 44, minHeight: 10 },
    );
    let filteredPanels = sortPanelSummaries(filterPanelSummaries(panels, query));

    const cleanup = (): unknown[] => {
      if (closed) return [];
      closed = true;
      panelNavigatorOpen = false;
      unregisterCancellation();
      const errors: unknown[] = [];
      const cleanupStep = (step: () => void) => {
        try {
          step();
        } catch (error) {
          errors.push(error);
        }
      };

      if (keyListenerAttached && onScreenKey) {
        cleanupStep(() => screen.removeListener('keypress', onScreenKey!));
        keyListenerAttached = false;
      }
      if (f11ListenerAttached && onF11) {
        cleanupStep(() => screen.unkey('f11', onF11!));
        f11ListenerAttached = false;
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
      return errors;
    };

    const finish = (result: number | null): void => {
      if (closed) return;
      const errors = cleanup();
      if (errors.length > 0) {
        reject(errors[0]);
      } else {
        resolve(result);
      }
    };
    unregisterCancellation = registerDialogCancellation(screen, () => finish(null));

    const renderFooter = (): void => {
      if (!footer) return;
      footer.setContent(currentGeometry.compact
        ? ' Search P-ID / #position  ↑↓ Select  Enter Go  Esc Cancel '
        : ' Search P-ID / #position / name / agent / path  ↑↓ Select  PgUp/PgDn Page  Enter Go  Esc Cancel ');
    };

    const renderList = (shouldRender = true): void => {
      if (!dialog || !input || !list) return;
      input.setValue(query);
      dialog.setLabel(
        ` Panel Navigator (F11) — ${filteredPanels.length}/${panels.length} `,
      );
      const rowWidth = Math.max(1, currentGeometry.width - 6);
      const items = filteredPanels.length > 0
        ? filteredPanels.map((panel) => formatPanelSummary(panel, rowWidth))
        : ['No matching panels'];
      list.setItems(items as any);
      if (filteredPanels.length > 0) {
        selectedIndex = Math.max(0, Math.min(selectedIndex, filteredPanels.length - 1));
        list.select(selectedIndex);
      } else {
        selectedIndex = -1;
        list.select(0);
      }
      renderFooter();
      if (shouldRender) screen.render();
    };

    const updateQuery = (nextQuery: string): void => {
      query = Array.from(nextQuery).slice(0, MAX_QUERY_LENGTH).join('');
      filteredPanels = sortPanelSummaries(filterPanelSummaries(panels, query));
      selectedIndex = 0;
      renderList();
    };

    const moveSelection = (delta: number): void => {
      if (!list || filteredPanels.length === 0) return;
      selectedIndex = Math.max(
        0,
        Math.min(filteredPanels.length - 1, selectedIndex + delta),
      );
      list.select(selectedIndex);
      screen.render();
    };

    try {
      dialog = blessed.box({
        parent: screen,
        top: 'center',
        left: 'center',
        width: currentGeometry.width,
        height: currentGeometry.height,
        border: { type: 'line' },
        style: {
          bg: theme.dialog.bg,
          fg: theme.dialog.fg,
          border: theme.dialog.border,
        },
        tags: false,
        shadow: true,
        label: ' Panel Navigator (F11) ',
      });

      input = blessed.textbox({
        parent: dialog,
        top: 1,
        left: 1,
        width: '100%-4',
        height: 3,
        border: { type: 'line' },
        label: ' Search ',
        keys: false,
        inputOnFocus: false,
        tags: false,
        style: {
          bg: 'black',
          fg: 'white',
          border: { fg: 'cyan' },
          focus: { bg: 'black', fg: 'white' },
        },
        value: query,
      });

      list = blessed.list({
        parent: dialog,
        top: 4,
        left: 1,
        width: '100%-4',
        height: Math.max(1, currentGeometry.height - 8),
        keys: false,
        mouse: true,
        tags: false,
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: 'cyan' } },
        style: {
          bg: theme.dialog.bg,
          fg: theme.dialog.fg,
          selected: { bg: 'cyan', fg: 'black' },
        },
        items: [] as any,
      });

      footer = blessed.text({
        parent: dialog,
        bottom: 0,
        left: 'center',
        tags: false,
        content: '',
        style: { bg: theme.dialog.bg, fg: 'cyan' },
      });

      const initialActiveIndex = filteredPanels.findIndex(
        (panel) => panel.panelId === activePanelId,
      );
      selectedIndex = initialActiveIndex >= 0 ? initialActiveIndex : 0;

      list.on('select item', (_item: unknown, index: number) => {
        if (index >= 0 && index < filteredPanels.length) selectedIndex = index;
      });
      list.on('select', (_item: unknown, index: number) => {
        const selected = filteredPanels[index];
        if (selected) finish(selected.panelId);
      });

      unbindResize = bindOverlayResize(
        screen,
        dialog,
        PREFERRED_WIDTH,
        PREFERRED_HEIGHT,
        (nextGeometry: OverlayGeometry) => {
          currentGeometry = nextGeometry;
          if (list) list.height = Math.max(1, nextGeometry.height - 8);
          renderList(false);
          screen.render();
        },
        { minWidth: 44, minHeight: 10 },
      );

      onScreenKey = (ch: string | undefined, key: any) => {
        if (closed || !key) return;
        const name = key.full || key.name;
        if (name === 'escape') {
          finish(null);
          return;
        }
        if (name === 'enter' || name === 'return') {
          const selected = filteredPanels[selectedIndex];
          if (selected) finish(selected.panelId);
          return;
        }
        if (name === 'up') {
          moveSelection(-1);
          return;
        }
        if (name === 'down') {
          moveSelection(1);
          return;
        }
        if (name === 'pageup') {
          const pageSize = Math.max(
            1,
            (typeof list?.height === 'number' ? list.height : 8) - 1,
          );
          moveSelection(-pageSize);
          return;
        }
        if (name === 'pagedown') {
          const pageSize = Math.max(
            1,
            (typeof list?.height === 'number' ? list.height : 8) - 1,
          );
          moveSelection(pageSize);
          return;
        }
        if (name === 'backspace') {
          updateQuery(Array.from(query).slice(0, -1).join(''));
          return;
        }
        if (name === 'C-u') {
          updateQuery('');
          return;
        }
        if (key.ctrl || key.meta) return;
        if (typeof ch === 'string' && ch.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(ch)) {
          updateQuery(query + ch);
        } else if (name === 'space') {
          updateQuery(`${query} `);
        }
      };

      screen.on('keypress', onScreenKey);
      keyListenerAttached = true;
      // Blessed emits raw `keypress` before `key f11`. Closing on the later
      // named event keeps the app-level F11 guard active for the same physical
      // keypress and prevents an immediate close/reopen cycle.
      onF11 = () => finish(null);
      screen.key(['f11'], onF11);
      f11ListenerAttached = true;
      renderList(false);
      input.focus();
      screen.render();
    } catch (error) {
      const cleanupErrors = cleanup();
      reject(cleanupErrors.length > 0
        ? new AggregateError(
          [error, ...cleanupErrors],
          'Panel navigator setup failed and cleanup also reported an error',
        )
        : error);
    }
  });
}
