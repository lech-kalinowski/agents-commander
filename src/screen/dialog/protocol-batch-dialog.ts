import blessed from 'blessed';
import type { Theme } from '../../config/types.js';
import { enterDialog, leaveDialog, registerDialogCancellation } from '../../utils/dialog-state.js';
import { sanitizeUserText } from '../../utils/user-facing-errors.js';
import { bindOverlayResize, screenGeometry, type OverlayGeometry } from './geometry.js';

export interface ProtocolBatchPanel {
  /** Zero-based stable protocol/session identity, displayed as P(panelIndex + 1). */
  panelIndex: number;
  name: string;
  profileId: string;
  armed: boolean;
}

const WIDTH = 88;
const HEIGHT = 25;
const openScreens = new WeakSet<blessed.Widgets.Screen>();

/** Explicitly select running sessions. Merely opening this picker selects none. */
export function showProtocolBatchDialog(
  screen: blessed.Widgets.Screen,
  theme: Theme,
  targets: readonly ProtocolBatchPanel[],
): Promise<number[] | null> {
  if (openScreens.has(screen)) return Promise.resolve(null);
  openScreens.add(screen);

  // Keep stable P-order and snapshot labels/eligibility while the picker is open.
  const panels = targets.map((target) => ({ ...target }))
    .sort((left, right) => left.panelIndex - right.panelIndex);

  return new Promise((resolve, reject) => {
    let dialog: blessed.Widgets.BoxElement | undefined;
    let list: blessed.Widgets.ListElement | undefined;
    let header: blessed.Widgets.TextElement | undefined;
    let footer: blessed.Widgets.TextElement | undefined;
    let continueButton: blessed.Widgets.BoxElement | undefined;
    let cancelButton: blessed.Widgets.BoxElement | undefined;
    let closed = false;
    let pending = false;
    let entered = false;
    let ownerCancelled = false;
    let cursor = 0;
    let unregister = () => {};
    let unbindResize = () => {};
    const previousGrab = screen.grabKeys;
    const selected = new Set<number>();
    let geometry = screenGeometry(screen, WIDTH, HEIGHT);

    const retainFocus = (element: blessed.Widgets.BoxElement) => {
      if (!closed && dialog && element !== dialog) dialog.focus();
    };
    const cleanup = (): unknown[] => {
      if (closed) return [];
      closed = true;
      openScreens.delete(screen);
      const errors: unknown[] = [];
      const safely = (step: () => void) => {
        try { step(); } catch (error) { errors.push(error); }
      };
      safely(unregister);
      safely(unbindResize);
      safely(() => screen.removeListener('element focus', retainFocus));
      screen.grabKeys = previousGrab;
      safely(() => dialog?.destroy());
      if (entered && !ownerCancelled) safely(() => leaveDialog(screen));
      if (!(screen as blessed.Widgets.Screen & { destroyed?: boolean }).destroyed) {
        safely(() => screen.render());
      }
      return errors;
    };
    const finish = (result: number[] | null, immediate = false) => {
      if (closed || (pending && !immediate)) return;
      pending = true;
      const complete = () => {
        if (closed) return;
        const errors = cleanup();
        if (errors.length) reject(errors[0]);
        else resolve(ownerCancelled ? null : result);
      };
      // Blessed dispatches enter and return for the same CR. Retain the input
      // shield until both events finish, with this exact selection frozen.
      if (immediate) complete();
      else queueMicrotask(complete);
    };
    const continueSelection = () => finish(panels
      .filter((panel) => !panel.armed && selected.has(panel.panelIndex))
      .map((panel) => panel.panelIndex));

    function row(panel: ProtocolBatchPanel): string {
      const state = panel.armed ? '[-]' : selected.has(panel.panelIndex) ? '[x]' : '[ ]';
      const label = panel.armed ? ' ALREADY ENABLED' : '';
      return sanitizeUserText(
        `${state} P${panel.panelIndex + 1}${label}  ${sanitizeUserText(panel.name, 120)}`
        + `  (${sanitizeUserText(panel.profileId, 100)})`,
        Math.max(1, geometry.width - 4),
      );
    }

    function render(): void {
      if (closed || !dialog || !list) return;
      dialog.setLabel(` Commander Protocol — ${selected.size} selected `);
      panels.forEach((panel, index) => list!.setItem(index, row(panel)));
      list.select(cursor);
      list.scrollTo(cursor);
      dialog.setFront();
      dialog.focus();
      screen.render();
    }

    function move(next: number): void {
      if (closed || pending || !panels.length) return;
      cursor = Math.max(0, Math.min(panels.length - 1, next));
      render();
    }

    function toggle(index: number): void {
      if (closed || pending) return;
      const panel = panels[index];
      if (!panel) return;
      cursor = index;
      if (!panel.armed) {
        if (selected.has(panel.panelIndex)) selected.delete(panel.panelIndex);
        else selected.add(panel.panelIndex);
      }
      render();
    }

    function layout(next: OverlayGeometry): void {
      geometry = next;
      if (!list || !header || !footer || !continueButton || !cancelButton) return;
      const width = Math.max(0, geometry.width - 2);
      const height = Math.max(0, geometry.height - 2);
      const headerRows = height >= 9 ? 1 : 0;
      const footerRows = height >= 7 ? 2 : height >= 4 ? 1 : 0;
      const buttonRows = height >= 2 && width >= 20 ? 1 : 0;
      const listRows = Math.max(0, height - headerRows - footerRows - buttonRows);
      for (const [element, top, rows] of [
        [header, 0, headerRows],
        [list, headerRows, listRows],
        [footer, headerRows + listRows, footerRows],
      ] as const) {
        element.top = top;
        element.left = 0;
        element.width = Math.max(1, width);
        element.height = Math.max(1, rows);
        if (rows && width) element.show();
        else element.hide();
      }
      footer.setContent(footerRows === 2
        ? 'Space=Toggle  A=All unarmed  N=Clear  Enter=Continue  Esc=Cancel\n'
          + 'Up/Down=Navigate  PgUp/PgDn=Page  Home/End=First/Last'
        : 'Space=Toggle A=All N=Clear Enter=Next Esc=Cancel');
      continueButton.top = Math.max(0, height - 1);
      cancelButton.top = Math.max(0, height - 1);
      continueButton.left = Math.max(0, Math.floor((width - 20) / 2));
      cancelButton.left = Number(continueButton.left) + 11;
      for (const button of [continueButton, cancelButton]) {
        if (buttonRows) button.show();
        else button.hide();
      }
      render();
    }

    try {
      enterDialog(screen);
      entered = true;
      screen.grabKeys = true;
      unregister = registerDialogCancellation(screen, () => {
        ownerCancelled = true;
        finish(null, true);
      });
      dialog = blessed.box({
        parent: screen, top: 'center', left: 'center',
        width: geometry.width, height: geometry.height,
        border: { type: 'line' }, tags: false, keys: true,
        shadow: true, mouse: true,
        style: { bg: theme.dialog.bg, fg: theme.dialog.fg, border: theme.dialog.border },
      });
      header = blessed.text({
        parent: dialog, tags: false,
        content: 'Choose running sessions. Already enabled sessions cannot be selected.',
        style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
      });
      list = blessed.list({
        parent: dialog, tags: false, keys: false, mouse: false,
        scrollable: true, alwaysScroll: true,
        scrollbar: { style: { bg: 'cyan' } },
        style: {
          bg: theme.dialog.bg, fg: theme.dialog.fg,
          selected: { bg: 'cyan', fg: 'black' },
        },
        items: (panels.length ? panels.map(row) : ['No running sessions']) as any,
      });
      // Blessed's built-in list mouse handler confirms only a second click and
      // accepts every mouse button. Each real left-click here toggles only.
      const rows = (list as blessed.Widgets.ListElement & {
        items: blessed.Widgets.BoxElement[];
      }).items;
      rows.forEach((item, index) => {
        item.on('click', (event: { button?: string }) => {
          if (event.button === 'left') toggle(index);
        });
      });
      list.on('element wheelup', () => move(cursor - 2));
      list.on('element wheeldown', () => move(cursor + 2));
      footer = blessed.text({
        parent: dialog, tags: false,
        style: { bg: theme.dialog.bg, fg: 'cyan' },
      });
      continueButton = blessed.box({
        parent: dialog, width: 10, height: 1, tags: false,
        mouse: true, autoFocus: false, content: '[Continue]',
        style: { bg: 'cyan', fg: 'black' },
      });
      cancelButton = blessed.box({
        parent: dialog, width: 9, height: 1, tags: false,
        mouse: true, autoFocus: false, content: '[Cancel]',
        style: { bg: theme.dialog.bg, fg: theme.dialog.fg },
      });
      continueButton.on('click', (event: { button?: string }) => {
        if (event.button === 'left') continueSelection();
      });
      cancelButton.on('click', (event: { button?: string }) => {
        if (event.button === 'left') finish(null);
      });
      dialog.on('keypress', (_character: string | undefined, key: {
        full?: string; name?: string; ctrl?: boolean; meta?: boolean;
      }) => {
        if (closed || pending || !key) return;
        const name = key.full || key.name;
        const page = Math.max(1, Number(list!.height) - 1);
        if (name === 'escape') finish(null);
        else if (name === 'enter' || name === 'return') continueSelection();
        else if (name === 'up') move(cursor - 1);
        else if (name === 'down') move(cursor + 1);
        else if (name === 'pageup') move(cursor - page);
        else if (name === 'pagedown') move(cursor + page);
        else if (name === 'home') move(0);
        else if (name === 'end') move(panels.length - 1);
        else if (name === 'space') toggle(cursor);
        else if (!key.ctrl && !key.meta && (name === 'a' || name === 'S-a')) {
          for (const panel of panels) if (!panel.armed) selected.add(panel.panelIndex);
          render();
        } else if (!key.ctrl && !key.meta && (name === 'n' || name === 'S-n')) {
          selected.clear();
          render();
        }
      });
      screen.on('element focus', retainFocus);
      unbindResize = bindOverlayResize(screen, dialog, WIDTH, HEIGHT, layout);
    } catch (error) {
      const cleanupErrors = cleanup();
      reject(cleanupErrors.length
        ? new AggregateError([error, ...cleanupErrors], 'Protocol picker setup and cleanup failed')
        : error);
    }
  });
}
