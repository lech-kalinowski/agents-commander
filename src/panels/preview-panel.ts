import blessed from 'blessed';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Theme } from '../config/types.js';
import { logger } from '../utils/logger.js';
import { enterDialog, leaveDialog } from '../utils/dialog-state.js';
import { formatUserError, sanitizeUserText } from '../utils/user-facing-errors.js';

const MAX_PREVIEW_BYTES = 1024 * 1024;

function escapeTaggedText(value: string): string {
  return (blessed as unknown as { escape(text: string): string }).escape(value);
}

function sanitizePreviewText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '\uFFFD');
}

export class PreviewPanel {
  public box: blessed.Widgets.BoxElement;
  private content: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private onClose: (() => void) | null = null;
  private closed = false;
  private dialogEntered = false;
  private loadGeneration = 0;

  constructor(
    screen: blessed.Widgets.Screen,
    theme: Theme,
    position: { top: number | string; left: number | string; width: number | string; height: number | string },
    onClose?: () => void,
  ) {
    this.screen = screen;
    this.theme = theme;
    this.onClose = onClose ?? null;

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
      label: ' View (F4) ',
    });

    this.content = blessed.box({
      parent: this.box,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: 'cyan' } },
      keys: true,
      vi: true,
      tags: true,
      style: {
        bg: theme.panel.bg,
        fg: theme.panel.fg,
      },
    });

    this.content.key(['escape', 'q', 'f4'], () => {
      this.close();
    });

    enterDialog();
    this.dialogEntered = true;
  }

  async loadFile(filePath: string): Promise<void> {
    const generation = ++this.loadGeneration;
    let handle: fs.FileHandle | null = null;
    try {
      handle = await fs.open(
        filePath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
      );
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw Object.assign(new Error('Only regular files can be previewed'), { code: 'EINVAL' });
      }
      if (stat.size > MAX_PREVIEW_BYTES) {
        if (this.closed || generation !== this.loadGeneration) return;
        this.content.setContent('File too large to preview (>1MB)');
        this.screen.render();
        return;
      }

      const bytes = Buffer.allocUnsafe(MAX_PREVIEW_BYTES + 1);
      let total = 0;
      while (total < bytes.length) {
        const result = await handle.read(bytes, total, bytes.length - total, total);
        if (result.bytesRead === 0) break;
        total += result.bytesRead;
      }
      if (total > MAX_PREVIEW_BYTES) {
        if (this.closed || generation !== this.loadGeneration) return;
        this.content.setContent('File too large to preview (>1MB)');
        this.screen.render();
        return;
      }

      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total));
      const text = escapeTaggedText(sanitizePreviewText(raw));
      const lines = text.split('\n');
      const numbered = lines
        .map((line, i) => {
          const num = String(i + 1).padStart(4);
          return `{cyan-fg}${num}{/cyan-fg} ${line}`;
        })
        .join('\n');

      if (this.closed || generation !== this.loadGeneration) return;
      const displayName = escapeTaggedText(sanitizeUserText(path.basename(filePath), 120));
      this.box.setLabel(` View: ${displayName} `);
      this.content.setContent(numbered);
      this.content.scrollTo(0);
    } catch (err) {
      if (this.closed || generation !== this.loadGeneration) return;
      logger.error(`Failed to read file for preview: ${filePath}`, err);
      this.content.setContent(escapeTaggedText(formatUserError('Preview', err)));
    } finally {
      await handle?.close().catch((err) => {
        logger.error(`Failed to close preview file: ${filePath}`, err);
      });
    }
    if (!this.closed && generation === this.loadGeneration) this.screen.render();
  }

  focus(): void {
    if (this.closed) return;
    this.content.focus();
    this.box.show();
    this.screen.render();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.loadGeneration++;
    if (this.dialogEntered) {
      leaveDialog();
      this.dialogEntered = false;
    }
    this.box.destroy();
    if (this.onClose) this.onClose();
    this.screen.render();
  }
}
