import blessed from 'blessed';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Theme } from '../config/types.js';
import { logger } from '../utils/logger.js';

export class MarkdownEditor {
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private container: blessed.Widgets.BoxElement;
  private editorBox: blessed.Widgets.BoxElement;
  private statusLine: blessed.Widgets.BoxElement;
  private lineNumbers: blessed.Widgets.BoxElement;
  private filePath: string;
  private modified = false;
  private onClose: () => void;

  private lines: string[] = [''];
  private cursorRow = 0;
  private cursorCol = 0;
  private scrollOffset = 0;

  constructor(
    screen: blessed.Widgets.Screen,
    theme: Theme,
    filePath: string,
    onClose: () => void,
  ) {
    this.screen = screen;
    this.theme = theme;
    this.filePath = filePath;
    this.onClose = onClose;

    // Full-screen container
    this.container = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: { bg: theme.editor.bg },
    });

    // Title bar
    blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { bg: 'cyan', fg: 'black' },
      content: ` Edit: ${path.basename(filePath)}`,
    });

    // Line numbers gutter
    this.lineNumbers = blessed.box({
      parent: this.container,
      top: 1,
      left: 0,
      width: 5,
      height: '100%-3',
      style: {
        bg: theme.editor.bg,
        fg: theme.editor.lineNumber.fg,
      },
    });

    // Editor content area
    this.editorBox = blessed.box({
      parent: this.container,
      top: 1,
      left: 5,
      width: '100%-5',
      height: '100%-3',
      style: {
        bg: theme.editor.bg,
        fg: theme.editor.fg,
      },
      tags: true,
    });

    // Status line
    this.statusLine = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      style: { bg: 'cyan', fg: 'black' },
    });
    this.updateStatusLine();
  }

  async open(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.lines = content.split('\n');
      if (this.lines.length === 0) this.lines = [''];
    } catch (err) {
      this.lines = [''];
      logger.error(`Failed to open file: ${this.filePath}`, err);
    }

    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollOffset = 0;
    this.setupKeys();
    this.render();
    this.container.focus();
    this.screen.render();
  }

  private get visibleHeight(): number {
    return (this.editorBox.height as number) || 20;
  }

  private get visibleWidth(): number {
    return ((this.editorBox.width as number) || 60) - 1;
  }

  private ensureCursorVisible(): void {
    if (this.cursorRow < this.scrollOffset) {
      this.scrollOffset = this.cursorRow;
    } else if (this.cursorRow >= this.scrollOffset + this.visibleHeight) {
      this.scrollOffset = this.cursorRow - this.visibleHeight + 1;
    }
  }

  private render(): void {
    this.ensureCursorVisible();
    const h = this.visibleHeight;
    const w = this.visibleWidth;

    // Render line numbers
    const numLines: string[] = [];
    for (let i = 0; i < h; i++) {
      const lineNum = this.scrollOffset + i;
      if (lineNum < this.lines.length) {
        numLines.push(String(lineNum + 1).padStart(4));
      } else {
        numLines.push('   ~');
      }
    }
    this.lineNumbers.setContent(numLines.join('\n'));

    // Render editor content with cursor
    const contentLines: string[] = [];
    for (let i = 0; i < h; i++) {
      const lineNum = this.scrollOffset + i;
      if (lineNum >= this.lines.length) {
        contentLines.push('');
        continue;
      }

      const line = this.lines[lineNum];
      if (lineNum === this.cursorRow) {
        // Insert cursor highlight
        const before = this.escapeTag(line.slice(0, this.cursorCol));
        const cursorChar = this.cursorCol < line.length ? this.escapeTag(line[this.cursorCol]) : ' ';
        const after = this.cursorCol < line.length ? this.escapeTag(line.slice(this.cursorCol + 1)) : '';
        contentLines.push(`${before}{black-fg}{cyan-bg}${cursorChar}{/cyan-bg}{/black-fg}${after}`);
      } else {
        contentLines.push(this.escapeTag(line));
      }
    }
    this.editorBox.setContent(contentLines.join('\n'));

    this.updateStatusLine();
    this.screen.render();
  }

  private escapeTag(s: string): string {
    // Escape curly braces so blessed tags are not interpreted
    return s.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  }

  private updateStatusLine(): void {
    const mod = this.modified ? ' [Modified]' : '';
    this.statusLine.setContent(
      ` ${path.basename(this.filePath)}${mod}  Ln ${this.cursorRow + 1}, Col ${this.cursorCol + 1}  (${this.lines.length} lines)\n` +
      ` ^S Save  ^Q/Esc Close`,
    );
  }

  private setupKeys(): void {
    // Arrow keys
    this.container.key(['up'], () => {
      if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
        this.render();
      }
    });

    this.container.key(['down'], () => {
      if (this.cursorRow < this.lines.length - 1) {
        this.cursorRow++;
        this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
        this.render();
      }
    });

    this.container.key(['left'], () => {
      if (this.cursorCol > 0) {
        this.cursorCol--;
      } else if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = this.lines[this.cursorRow].length;
      }
      this.render();
    });

    this.container.key(['right'], () => {
      if (this.cursorCol < this.lines[this.cursorRow].length) {
        this.cursorCol++;
      } else if (this.cursorRow < this.lines.length - 1) {
        this.cursorRow++;
        this.cursorCol = 0;
      }
      this.render();
    });

    // Home / End
    this.container.key(['home'], () => {
      this.cursorCol = 0;
      this.render();
    });

    this.container.key(['end'], () => {
      this.cursorCol = this.lines[this.cursorRow].length;
      this.render();
    });

    // Page Up / Page Down
    this.container.key(['pageup'], () => {
      this.cursorRow = Math.max(0, this.cursorRow - this.visibleHeight);
      this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
      this.render();
    });

    this.container.key(['pagedown'], () => {
      this.cursorRow = Math.min(this.lines.length - 1, this.cursorRow + this.visibleHeight);
      this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
      this.render();
    });

    // Enter - new line
    this.container.key(['enter'], () => {
      const line = this.lines[this.cursorRow];
      const before = line.slice(0, this.cursorCol);
      const after = line.slice(this.cursorCol);
      this.lines[this.cursorRow] = before;
      this.lines.splice(this.cursorRow + 1, 0, after);
      this.cursorRow++;
      this.cursorCol = 0;
      this.modified = true;
      this.render();
    });

    // Backspace
    this.container.key(['backspace'], () => {
      if (this.cursorCol > 0) {
        const line = this.lines[this.cursorRow];
        this.lines[this.cursorRow] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol);
        this.cursorCol--;
      } else if (this.cursorRow > 0) {
        // Merge with previous line
        const currentLine = this.lines[this.cursorRow];
        this.lines.splice(this.cursorRow, 1);
        this.cursorRow--;
        this.cursorCol = this.lines[this.cursorRow].length;
        this.lines[this.cursorRow] += currentLine;
      }
      this.modified = true;
      this.render();
    });

    // Delete
    this.container.key(['delete'], () => {
      const line = this.lines[this.cursorRow];
      if (this.cursorCol < line.length) {
        this.lines[this.cursorRow] = line.slice(0, this.cursorCol) + line.slice(this.cursorCol + 1);
      } else if (this.cursorRow < this.lines.length - 1) {
        // Merge with next line
        this.lines[this.cursorRow] += this.lines[this.cursorRow + 1];
        this.lines.splice(this.cursorRow + 1, 1);
      }
      this.modified = true;
      this.render();
    });

    // Tab - insert spaces
    this.container.key(['tab'], () => {
      const spaces = '  ';
      const line = this.lines[this.cursorRow];
      this.lines[this.cursorRow] = line.slice(0, this.cursorCol) + spaces + line.slice(this.cursorCol);
      this.cursorCol += spaces.length;
      this.modified = true;
      this.render();
    });

    // Ctrl+S - Save
    this.container.key(['C-s'], async () => {
      await this.save();
    });

    // Ctrl+Q / Escape - Close
    this.container.key(['C-q', 'escape'], async () => {
      if (this.modified) {
        const { showConfirmDialog } = await import('../screen/dialog/confirm-dialog.js');
        const discard = await showConfirmDialog(
          this.screen,
          this.theme,
          'Unsaved Changes',
          'Discard unsaved changes?',
        );
        if (!discard) return;
      }

      this.close();
    });

    // Character input - capture printable characters
    this.screen.on('keypress', this.handleKeypress);
  }

  private handleKeypress = (ch: string, key: any): void => {
    // Only handle when this editor is active
    if (!this.container.visible) return;

    // Ignore control keys, function keys, and special keys
    if (!ch || key.ctrl || key.meta || key.name === 'escape' || key.name === 'tab' ||
        key.name === 'enter' || key.name === 'return' || key.name === 'backspace' ||
        key.name === 'delete' || key.name === 'up' || key.name === 'down' ||
        key.name === 'left' || key.name === 'right' || key.name === 'home' ||
        key.name === 'end' || key.name === 'pageup' || key.name === 'pagedown' ||
        key.name === 'insert' || (key.name && key.name.startsWith('f'))) {
      return;
    }

    // Insert character
    const line = this.lines[this.cursorRow];
    this.lines[this.cursorRow] = line.slice(0, this.cursorCol) + ch + line.slice(this.cursorCol);
    this.cursorCol++;
    this.modified = true;
    this.render();
  };

  private async save(): Promise<void> {
    try {
      const content = this.lines.join('\n');
      await fs.writeFile(this.filePath, content, 'utf-8');
      this.modified = false;
      this.render();
      logger.info(`Saved file: ${this.filePath}`);
    } catch (err) {
      logger.error(`Failed to save file: ${this.filePath}`, err);
    }
  }

  private close(): void {
    this.screen.removeListener('keypress', this.handleKeypress);
    this.container.destroy();
    this.onClose();
    this.screen.render();
  }
}
