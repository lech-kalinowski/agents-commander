import blessed from 'blessed';
import path from 'node:path';
import type { Theme } from '../config/types.js';
import type { FileEntry, SortOptions } from '../file-manager/types.js';
import { readDirectory } from '../file-manager/file-system.js';
import { sortFiles } from '../file-manager/file-sorter.js';
import { formatFileSize, formatDate, truncate } from '../utils/format.js';
import { logger } from '../utils/logger.js';

export class FilePanel {
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
  public panelIndex: number;
  private _focused = false;

  /** Called when the user clicks anywhere on this panel (for focus switching). */
  public onMouseClick: (() => void) | null = null;

  get currentPath(): string {
    return this._currentPath;
  }

  get focused(): boolean {
    return this._focused;
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
  ) {
    this.screen = screen;
    this.theme = theme;
    this.panelIndex = panelIndex;
    this._currentPath = initialPath;

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
      label: ` ${this.shortPath(initialPath)} `,
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

  private updateHeader(): void {
    const w = (this.box.width as number) - 4;
    if (w <= 0) return;
    const nameW = Math.max(10, w - 22);
    const header = 'Name'.padEnd(nameW) + 'Size'.padStart(8) + '  ' + 'Modified'.padEnd(12);
    this.headerBox.setContent(header);
  }

  private formatRow(entry: FileEntry): string {
    const w = (this.box.width as number) - 4;
    if (w <= 0) return entry.name;
    const nameW = Math.max(10, w - 22);

    const isSelected = this.selectedFiles.has(entry.fullPath);
    let name = entry.name;
    if (entry.isDirectory) {
      name = '/' + name;
    }
    name = truncate(name, nameW).padEnd(nameW);

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

    return `${prefix}${name}${size}  ${date}${suffix}`;
  }

  async loadDirectory(dirPath?: string): Promise<void> {
    if (dirPath) {
      this._currentPath = dirPath;
    }

    try {
      const raw = await readDirectory(this._currentPath, this.showHidden);
      this.entries = sortFiles(raw, this.sortOptions);
      this.selectedFiles.clear();
      this.refreshList();
      this.box.setLabel(` ${this.shortPath(this._currentPath)} `);

      if (this.cursorIndex >= this.entries.length + 1) {
        this.cursorIndex = 0;
      }
      this.list.select(this.cursorIndex);
    } catch (err) {
      logger.error(`Failed to read directory: ${this._currentPath}`, err);
    }
  }

  private refreshList(): void {
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
    this.screen.render();
  }

  setFocus(focused: boolean): void {
    this._focused = focused;
    this.box.style.border = focused ? this.theme.panel.borderFocus : this.theme.panel.border;
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
    });

    // Enter key - navigate into directory or trigger file open
    this.list.key(['enter'], () => {
      if (this.cursorIndex === 0) {
        // Go up
        const parent = path.dirname(this._currentPath);
        if (parent !== this._currentPath) {
          this.cursorIndex = 0;
          this.loadDirectory(parent);
        }
        return;
      }

      const entry = this.entries[this.cursorIndex - 1];
      if (entry?.isDirectory) {
        this.cursorIndex = 0;
        this.loadDirectory(entry.fullPath);
      }
      // File open will be handled by the app
    });

    // Backspace - go to parent
    this.list.key(['backspace'], () => {
      const parent = path.dirname(this._currentPath);
      if (parent !== this._currentPath) {
        this.cursorIndex = 0;
        this.loadDirectory(parent);
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
        this.list.select(this.cursorIndex);
      }

      this.refreshList();
    });
  }

  resize(position: { top: number | string; left: number | string; width: number | string; height: number | string }): void {
    this.box.top = position.top;
    this.box.left = position.left;
    this.box.width = position.width;
    this.box.height = position.height;
    this.refreshList();
  }

  focusEntry(fullPath: string): void {
    const index = this.entries.findIndex((entry) => entry.fullPath === fullPath);
    if (index === -1) return;
    this.cursorIndex = index + 1;
    this.list.select(this.cursorIndex);
    this.screen.render();
  }

  destroy(): void {
    this.box.destroy();
  }
}
