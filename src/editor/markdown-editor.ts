import blessed from 'blessed';
import path from 'node:path';
import type { Theme } from '../config/types.js';
import { logger } from '../utils/logger.js';
import {
  enterDialog,
  leaveDialog,
  registerDialogCancellation,
} from '../utils/dialog-state.js';
import { showErrorToast, showToast } from '../screen/toast.js';
import {
  EditorFileIO,
  editorFileErrorMessage,
  type EditorFileBaseline,
} from './editor-file-io.js';

interface MarkdownEditorOptions {
  tabSize?: number;
  wordWrap?: boolean;
  fileIO?: EditorFileIO;
}

function safeBaseName(filePath: string): string {
  return path.basename(filePath)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '\uFFFD')
    .replace(/\{/g, '\uFF5B')
    .replace(/\}/g, '\uFF5D');
}

interface GraphemeSegment {
  index: number;
}

interface GraphemeSegmenter {
  segment(input: string): Iterable<GraphemeSegment>;
}

const SegmenterConstructor = (
  Intl as unknown as {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity: 'grapheme' },
    ) => GraphemeSegmenter;
  }
).Segmenter;
const graphemeSegmenter = SegmenterConstructor
  ? new SegmenterConstructor(undefined, { granularity: 'grapheme' })
  : null;

function graphemeBoundaries(text: string): number[] {
  if (graphemeSegmenter) {
    const boundaries = Array.from(
      graphemeSegmenter.segment(text),
      (part) => part.index,
    );
    if (boundaries[0] !== 0) boundaries.unshift(0);
    if (boundaries[boundaries.length - 1] !== text.length) boundaries.push(text.length);
    return boundaries;
  }

  // Node 20 always has Intl.Segmenter. This fallback still guarantees that
  // older runtimes never split a UTF-16 surrogate pair.
  const boundaries = [0];
  let offset = 0;
  for (const codePoint of text) {
    offset += codePoint.length;
    boundaries.push(offset);
  }
  return boundaries;
}

function boundaryAtOrBefore(text: string, offset: number): number {
  const target = Math.max(0, Math.min(offset, text.length));
  let result = 0;
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > target) break;
    result = boundary;
  }
  return result;
}

function boundaryAtOrAfter(text: string, offset: number): number {
  const target = Math.max(0, Math.min(offset, text.length));
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary >= target) return boundary;
  }
  return text.length;
}

function previousGraphemeBoundary(text: string, offset: number): number {
  const target = Math.max(0, Math.min(offset, text.length));
  let previous = 0;
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary >= target) break;
    previous = boundary;
  }
  return previous;
}

function nextGraphemeBoundary(text: string, offset: number): number {
  const target = Math.max(0, Math.min(offset, text.length));
  for (const boundary of graphemeBoundaries(text)) {
    if (boundary > target) return boundary;
  }
  return text.length;
}

function graphemeColumn(text: string, offset: number): number {
  const target = boundaryAtOrBefore(text, offset);
  return Math.max(0, graphemeBoundaries(text).indexOf(target));
}

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
  private tabSize: number;
  private wordWrap: boolean;
  private fileIO: EditorFileIO;
  private baseline: EditorFileBaseline | null = null;
  private saveInFlight: Promise<boolean> | null = null;
  private keyHandlerInstalled = false;
  private closed = false;
  private inputSuspended = false;
  private dialogStateOwned = false;
  private unregisterCancellation: (() => void) | null = null;

  private lines: string[] = [''];
  private cursorRow = 0;
  private cursorCol = 0;
  private scrollOffset = 0;

  constructor(
    screen: blessed.Widgets.Screen,
    theme: Theme,
    filePath: string,
    onClose: () => void,
    options: MarkdownEditorOptions = {},
  ) {
    this.screen = screen;
    this.theme = theme;
    this.filePath = filePath;
    this.onClose = onClose;
    this.tabSize = Math.max(1, Math.min(16, Math.trunc(options.tabSize ?? 2)));
    this.wordWrap = options.wordWrap ?? true;
    this.fileIO = options.fileIO ?? new EditorFileIO();

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
      tags: false,
      style: { bg: 'cyan', fg: 'black' },
      content: ` Edit: ${safeBaseName(filePath)}`,
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
      wrap: this.wordWrap,
    });

    // Status line
    this.statusLine = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: false,
      style: { bg: 'cyan', fg: 'black' },
    });
    this.updateStatusLine();
    enterDialog(screen);
    this.dialogStateOwned = true;
    this.unregisterCancellation = registerDialogCancellation(
      screen,
      () => this.destroyAndRestoreFocus(),
    );
  }

  async open(): Promise<boolean> {
    if (this.closed) return false;
    try {
      const loaded = await this.fileIO.load(this.filePath);
      if (this.closed) return false;
      this.baseline = loaded.baseline;
      this.lines = loaded.content.split('\n');
      if (this.lines.length === 0) this.lines = [''];
    } catch (err) {
      if (this.closed) return false;
      logger.error(`Failed to open file: ${this.filePath}`, err);
      this.destroyAndRestoreFocus();
      showErrorToast(
        this.screen,
        `Cannot edit ${safeBaseName(this.filePath)}: ${editorFileErrorMessage(err)}`,
      );
      return false;
    }

    this.modified = false;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollOffset = 0;
    this.setupKeys();
    this.render();
    this.container.focus();
    this.screen.render();
    return true;
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
        const cursorStart = boundaryAtOrBefore(line, this.cursorCol);
        const cursorEnd = nextGraphemeBoundary(line, cursorStart);
        const before = this.escapeTag(line.slice(0, cursorStart));
        const cursorChar = cursorStart < line.length
          ? this.escapeTag(line.slice(cursorStart, cursorEnd))
          : ' ';
        const after = cursorStart < line.length ? this.escapeTag(line.slice(cursorEnd)) : '';
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
    const sanitized = s.replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
      '\uFFFD',
    );
    return (blessed as unknown as { escape(text: string): string }).escape(sanitized);
  }

  private updateStatusLine(): void {
    const mod = this.modified ? ' [Modified]' : '';
    const currentLine = this.lines[this.cursorRow] ?? '';
    const column = graphemeColumn(currentLine, this.cursorCol) + 1;
    this.statusLine.setContent(
      ` ${safeBaseName(this.filePath)}${mod}  Ln ${this.cursorRow + 1}, Col ${column}  (${this.lines.length} lines)\n` +
      ` ^S Save  ^Q/Esc Close`,
    );
  }

  private setupKeys(): void {
    // Arrow keys
    this.container.key(['up'], () => {
      if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = boundaryAtOrBefore(this.lines[this.cursorRow], this.cursorCol);
        this.render();
      }
    });

    this.container.key(['down'], () => {
      if (this.cursorRow < this.lines.length - 1) {
        this.cursorRow++;
        this.cursorCol = boundaryAtOrBefore(this.lines[this.cursorRow], this.cursorCol);
        this.render();
      }
    });

    this.container.key(['left'], () => {
      if (this.cursorCol > 0) {
        this.cursorCol = previousGraphemeBoundary(
          this.lines[this.cursorRow],
          this.cursorCol,
        );
      } else if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = this.lines[this.cursorRow].length;
      }
      this.render();
    });

    this.container.key(['right'], () => {
      if (this.cursorCol < this.lines[this.cursorRow].length) {
        this.cursorCol = nextGraphemeBoundary(
          this.lines[this.cursorRow],
          this.cursorCol,
        );
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
      this.cursorCol = boundaryAtOrBefore(this.lines[this.cursorRow], this.cursorCol);
      this.render();
    });

    this.container.key(['pagedown'], () => {
      this.cursorRow = Math.min(this.lines.length - 1, this.cursorRow + this.visibleHeight);
      this.cursorCol = boundaryAtOrBefore(this.lines[this.cursorRow], this.cursorCol);
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
        const previous = previousGraphemeBoundary(line, this.cursorCol);
        this.lines[this.cursorRow] = line.slice(0, previous) + line.slice(this.cursorCol);
        this.cursorCol = previous;
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
        const next = nextGraphemeBoundary(line, this.cursorCol);
        this.lines[this.cursorRow] = line.slice(0, this.cursorCol) + line.slice(next);
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
      const line = this.lines[this.cursorRow];
      const column = graphemeColumn(line, this.cursorCol);
      const spaces = ' '.repeat(this.tabSize - (column % this.tabSize));
      this.lines[this.cursorRow] = line.slice(0, this.cursorCol) + spaces + line.slice(this.cursorCol);
      this.cursorCol += spaces.length;
      this.modified = true;
      this.render();
    });

    // Ctrl+S - Save
    this.container.key(['C-s'], () => {
      void this.save();
    });

    // Ctrl+Q / Escape - Close
    this.container.key(['C-q', 'escape'], async () => {
      if (this.saveInFlight) {
        showToast(this.screen, 'Save in progress');
        return;
      }
      if (this.modified) {
        this.inputSuspended = true;
        let discard = false;
        try {
          const { showConfirmDialog } = await import('../screen/dialog/confirm-dialog.js');
          discard = await showConfirmDialog(
            this.screen,
            this.theme,
            'Unsaved Changes',
            'Discard unsaved changes?',
          );
        } finally {
          this.inputSuspended = false;
          if (!this.closed) {
            this.container.focus();
            this.screen.render();
          }
        }
        if (!discard) return;
      }

      this.close();
    });

    // Character input - capture printable characters
    this.screen.on('keypress', this.handleKeypress);
    this.keyHandlerInstalled = true;
  }

  private handleEditorKeypress(ch: string, key: any): void {
    // Only handle when this editor is active
    if (!this.container.visible || !this.hasEditorFocus() || this.inputSuspended) return;

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
    const insertionStart = boundaryAtOrBefore(line, this.cursorCol);
    const nextLine = line.slice(0, insertionStart) + ch + line.slice(insertionStart);
    this.lines[this.cursorRow] = nextLine;
    this.cursorCol = boundaryAtOrAfter(nextLine, insertionStart + ch.length);
    this.modified = true;
    this.render();
  }

  private hasEditorFocus(): boolean {
    let focused = this.screen.focused;
    while (focused) {
      if (focused === this.container) return true;
      focused = focused.parent;
    }
    return false;
  }

  private handleKeypress = (ch: string, key: any): void => {
    this.handleEditorKeypress(ch, key);
  };

  private save(): Promise<boolean> {
    if (this.saveInFlight) return this.saveInFlight;

    const pending = this.performSave();
    this.saveInFlight = pending;
    const clearPending = () => {
      if (this.saveInFlight === pending) this.saveInFlight = null;
    };
    void pending.then(clearPending, clearPending);
    return pending;
  }

  private async performSave(): Promise<boolean> {
    if (!this.baseline) {
      this.modified = true;
      showErrorToast(this.screen, 'Save failed: file was not loaded safely');
      return false;
    }

    const content = this.lines.join('\n');
    const baseline = this.baseline;
    try {
      const nextBaseline = await this.fileIO.save(this.filePath, content, baseline);
      this.baseline = nextBaseline;
      this.modified = this.lines.join('\n') !== content;
      if (!this.closed) {
        this.render();
        showToast(this.screen, `Saved ${safeBaseName(this.filePath)}`);
      }
      logger.info(`Saved file: ${this.filePath}`);
      return true;
    } catch (err) {
      logger.error(`Failed to save file: ${this.filePath}`, err);
      if (!this.closed) {
        this.render();
        showErrorToast(this.screen, `Save failed: ${editorFileErrorMessage(err)}`);
      }
      return false;
    }
  }

  private close(): void {
    if (this.closed) return;
    this.destroyAndRestoreFocus();
    this.screen.render();
  }

  private destroyAndRestoreFocus(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.keyHandlerInstalled) {
      this.screen.removeListener('keypress', this.handleKeypress);
      this.keyHandlerInstalled = false;
    }
    try {
      this.container.destroy();
    } catch (err) {
      logger.error('Failed to destroy editor overlay', err);
    }
    if (this.dialogStateOwned) {
      this.unregisterCancellation?.();
      this.unregisterCancellation = null;
      this.dialogStateOwned = false;
      leaveDialog(this.screen);
    }
    try {
      this.onClose();
    } catch (err) {
      logger.error('Failed to restore focus after closing editor', err);
    }
    this.screen.render();
  }
}
