import blessed from 'blessed';
import path from 'node:path';
import type { Theme } from '../config/types.js';
import type { FileEntry, SortOptions } from '../file-manager/types.js';
import { readDirectory } from '../file-manager/file-system.js';
import { sortFiles } from '../file-manager/file-sorter.js';
import { showErrorToast } from '../screen/toast.js';
import { formatFileSize, formatDate, truncate } from '../utils/format.js';
import { logger } from '../utils/logger.js';
import { isPanelId } from '../panel-limits.js';
import { isDialogActive } from '../utils/dialog-state.js';

interface FilePanelOptions {
  showHidden?: boolean;
  sortBy?: SortOptions['field'];
  sortAscending?: boolean;
}

export class FilePanel {
  private static pendingScreenRenders = new WeakMap<
    blessed.Widgets.Screen,
    ReturnType<typeof setTimeout>
  >();

  public box: blessed.Widgets.BoxElement;
  public list: blessed.Widgets.ListElement;
  private headerBox: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private _currentPath: string;
  private entries: FileEntry[] = [];
  private selectedFiles: Set<string> = new Set();
  private cursorIndex = 0;
  private sortOptions: SortOptions = {
    field: 'name',
    ascending: true,
    directoriesFirst: true,
  };
  private showHidden = false;
  private loadGeneration = 0;
  private destroyed = false;
  private _visible = true;
  public panelIndex: number;
  private _focused = false;

  /** Called when the user clicks anywhere on this panel (for focus switching). */
  public onMouseClick: (() => void) | null = null;
  /** Called when keyboard or mouse navigation changes the current entry. */
  public onSelectionChange: (() => void) | null = null;
  /** Called when Enter is pressed on a non-directory entry. */
  public onOpenFile: ((entry: FileEntry) => void) | null = null;

  get currentPath(): string {
    return this._currentPath;
  }

  get focused(): boolean {
    return this._focused;
  }

  get isVisible(): boolean {
    return this._visible;
  }

  get currentEntry(): FileEntry | null {
    // Account for ".." entry at index 0
    if (this.cursorIndex === 0) return null;
    return this.entries[this.cursorIndex - 1] ?? null;
  }

  get selectedEntries(): FileEntry[] {
    if (this.selectedFiles.size === 0) {
      const current = this.currentEntry;
      return current ? [current] : [];
    }
    return this.entries.filter((e) => this.selectedFiles.has(e.fullPath));
  }

  get otherPanelPath(): string {
    return this._currentPath; // Will be overridden by layout manager
  }

  constructor(
    screen: blessed.Widgets.Screen,
    theme: Theme,
    panelIndex: number,
    initialPath: string,
    position: { top: number | string; left: number | string; width: number | string; height: number | string },
    options: FilePanelOptions = {},
  ) {
    this.screen = screen;
    this.theme = theme;
    this.panelIndex = panelIndex;
    this._currentPath = initialPath;
    this.showHidden = options.showHidden ?? false;
    this.sortOptions = {
      ...this.sortOptions,
      field: options.sortBy ?? this.sortOptions.field,
      ascending: options.sortAscending ?? this.sortOptions.ascending,
    };

    // Main container box with border
    this.box = blessed.box({
      parent: screen,
      top: position.top,
      left: position.left,
      width: position.width,
      height: position.height,
      border: { type: 'line' },
      style: {
        bg: theme.panel.bg,
        fg: theme.panel.fg,
        border: theme.panel.border,
      },
      tags: true,
      label: this.panelLabel(initialPath),
    });

    // Column header
    this.headerBox = blessed.box({
      parent: this.box,
      top: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      tags: true,
      style: {
        bg: theme.panel.header.bg,
        fg: theme.panel.header.fg,
      },
    });
    this.updateHeader();

    // File list
    this.list = blessed.list({
      parent: this.box,
      top: 1,
      left: 0,
      width: '100%-2',
      height: '100%-4',
      tags: true,
      keys: true,
      vi: false,
      mouse: true,
      scrollable: true,
      scrollbar: {
        style: { bg: 'cyan' },
      },
      style: {
        bg: theme.panel.bg,
        fg: theme.panel.fg,
        selected: {
          bg: theme.panel.cursor.bg,
          fg: theme.panel.cursor.fg,
        },
      },
    });

    // Summary line at bottom of panel
    this.setupKeyBindings();

    // Click to focus — notify parent layout
    this.box.on('click', () => {
      if (isDialogActive()) return;
      if (this.onMouseClick) this.onMouseClick();
    });
  }

  private shortPath(p: string): string {
    const home = process.env.HOME || '';
    if (home && p.startsWith(home)) {
      return '~' + p.slice(home.length);
    }
    return p;
  }

  private sanitizeDisplayText(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '\uFFFD');
  }

  private escapeTaggedText(value: string): string {
    const escape = (blessed as unknown as { escape(text: string): string }).escape;
    return escape(this.sanitizeDisplayText(value));
  }

  private panelLabel(dirPath: string): string {
    const panelNumber = isPanelId(this.panelIndex) ? String(this.panelIndex + 1) : '?';
    return ` P${panelNumber} · ${this.escapeTaggedText(this.shortPath(dirPath))} `;
  }

  private updateHeader(): void {
    const w = (this.box.width as number) - 4;
    if (w <= 0) return;
    const nameW = Math.max(10, w - 22);
    const header = 'Name'.padEnd(nameW) + 'Size'.padStart(8) + '  ' + 'Modified'.padEnd(12);
    this.headerBox.setContent(header);
  }

  private formatRow(entry: FileEntry): string {
    const w = (this.box.width as number) - 4;
    if (w <= 0) return this.escapeTaggedText(entry.name);
    const nameW = Math.max(10, w - 22);

    const isSelected = this.selectedFiles.has(entry.fullPath);
    let name = this.sanitizeDisplayText(entry.name);
    if (entry.isDirectory) {
      name = '/' + name;
    }
    name = truncate(name, nameW).padEnd(nameW);
    const safeName = this.escapeTaggedText(name);

    const size = entry.isDirectory ? '  <DIR>' : formatFileSize(entry.size);
    const date = formatDate(entry.modified);

    let prefix = '';
    let suffix = '';

    if (isSelected) {
      prefix = `{yellow-fg}`;
      suffix = `{/yellow-fg}`;
    } else if (entry.isDirectory) {
      prefix = `{white-fg}{bold}`;
      suffix = `{/bold}{/white-fg}`;
    }

    return `${prefix}${safeName}${size}  ${date}${suffix}`;
  }

  async loadDirectory(dirPath = this._currentPath): Promise<boolean> {
    if (this.destroyed) return false;
    const generation = ++this.loadGeneration;
    let nextEntries: FileEntry[];
    try {
      const raw = await readDirectory(dirPath, this.showHidden);
      if (generation !== this.loadGeneration) return false;
      nextEntries = sortFiles(raw, this.sortOptions);
    } catch (err) {
      if (generation !== this.loadGeneration) return false;
      logger.error(`Failed to read directory: ${dirPath}`, err);
      const detail = err instanceof Error && err.message
        ? `: ${this.sanitizeDisplayText(err.message)}`
        : '';
      const displayPath = this.sanitizeDisplayText(this.shortPath(dirPath));
      showErrorToast(this.screen, `Unable to open ${displayPath}${detail}`);
      return false;
    }

    const pathChanged = dirPath !== this._currentPath;
    const nextCursor = pathChanged || this.cursorIndex >= nextEntries.length + 1
      ? 0
      : this.cursorIndex;

    this._currentPath = dirPath;
    this.entries = nextEntries;
    this.selectedFiles.clear();
    this.cursorIndex = nextCursor;
    if (this._visible) {
      this.box.setLabel(this.panelLabel(dirPath));
      this.refreshList();
      this.list.select(nextCursor);
    }
    return true;
  }

  private refreshList(render = true): void {
    if (this.destroyed || !this._visible) return;
    const items: string[] = [];

    // Parent directory entry
    const w = (this.box.width as number) - 4;
    const nameW = Math.max(10, w - 22);
    items.push('{bold}/..{/bold}'.padEnd(nameW + 20) + '   <UP>');

    for (const entry of this.entries) {
      items.push(this.formatRow(entry));
    }

    this.list.setItems(items as any);
    this.updateHeader();
    if (render) this.screen.render();
  }

  private static scheduleScreenRender(screen: blessed.Widgets.Screen): void {
    if (FilePanel.pendingScreenRenders.has(screen)) return;
    const timer = setTimeout(() => {
      FilePanel.pendingScreenRenders.delete(screen);
      try {
        screen.render();
      } catch {
        // The owning screen may have been destroyed while a repaint was queued.
      }
    }, 0);
    FilePanel.pendingScreenRenders.set(screen, timer);
  }

  setVisible(visible: boolean): void {
    if (this.destroyed || this._visible === visible) return;
    this._visible = visible;

    if (!visible) {
      const focusedChild = this.screen.focused === this.list;
      this.box.hide();
      if (focusedChild && this.screen.focused === this.list) {
        this.screen.rewindFocus();
      }
      FilePanel.scheduleScreenRender(this.screen);
      return;
    }

    this.box.show();
    this.box.setLabel(this.panelLabel(this._currentPath));
    this.box.style.border = this._focused
      ? this.theme.panel.borderFocus
      : this.theme.panel.border;
    this.refreshList(false);
    this.list.select(this.cursorIndex);
    if (this._focused) this.list.focus();
    FilePanel.scheduleScreenRender(this.screen);
  }

  setFocus(focused: boolean): void {
    this._focused = focused;
    this.box.style.border = focused ? this.theme.panel.borderFocus : this.theme.panel.border;
    if (!this._visible) return;
    if (focused) {
      this.list.focus();
    }
    this.screen.render();
  }

  toggleHidden(): void {
    this.showHidden = !this.showHidden;
    this.loadDirectory();
  }

  setSortField(field: 'name' | 'size' | 'date' | 'ext'): void {
    if (this.sortOptions.field === field) {
      this.sortOptions.ascending = !this.sortOptions.ascending;
    } else {
      this.sortOptions.field = field;
      this.sortOptions.ascending = true;
    }
    this.loadDirectory();
  }

  private setupKeyBindings(): void {
    this.list.on('select item', (_item: any, index: number) => {
      this.cursorIndex = index;
      this.onSelectionChange?.();
    });

    // Enter key - navigate into directory or trigger file open
    this.list.key(['enter'], () => {
      if (this.cursorIndex === 0) {
        // Go up
        const parent = path.dirname(this._currentPath);
        if (parent !== this._currentPath) {
          void this.loadDirectory(parent);
        }
        return;
      }

      const entry = this.entries[this.cursorIndex - 1];
      if (entry?.isDirectory) {
        void this.loadDirectory(entry.fullPath);
        return;
      }
      if (entry) {
        this.onOpenFile?.(entry);
      }
    });

    // Backspace - go to parent
    this.list.key(['backspace'], () => {
      const parent = path.dirname(this._currentPath);
      if (parent !== this._currentPath) {
        void this.loadDirectory(parent);
      }
    });

    // Insert - toggle selection
    this.list.key(['insert'], () => {
      if (this.cursorIndex === 0) return;
      const entry = this.entries[this.cursorIndex - 1];
      if (!entry) return;

      if (this.selectedFiles.has(entry.fullPath)) {
        this.selectedFiles.delete(entry.fullPath);
      } else {
        this.selectedFiles.add(entry.fullPath);
      }

      // Move cursor down
      if (this.cursorIndex < this.entries.length) {
        this.cursorIndex++;
        if (this._visible) this.list.select(this.cursorIndex);
      }

      this.refreshList();
    });
  }

  resize(position: { top: number | string; left: number | string; width: number | string; height: number | string }): void {
    this.box.top = position.top;
    this.box.left = position.left;
    this.box.width = position.width;
    this.box.height = position.height;
    if (this._visible) this.refreshList();
  }

  focusEntry(fullPath: string): void {
    const index = this.entries.findIndex((entry) => entry.fullPath === fullPath);
    if (index === -1) return;
    this.cursorIndex = index + 1;
    if (!this._visible) return;
    this.list.select(this.cursorIndex);
    this.screen.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this._visible = false;
    this.loadGeneration++;
    this.onMouseClick = null;
    this.onSelectionChange = null;
    this.onOpenFile = null;
    this.box.destroy();
  }
}
