import blessed from 'blessed';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Theme } from '../config/types.js';
import { logger } from '../utils/logger.js';

export class PreviewPanel {
  public box: blessed.Widgets.BoxElement;
  private content: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private onClose: (() => void) | null = null;

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
      label: ' View (F3) ',
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

    this.content.key(['escape', 'q', 'f3'], () => {
      this.close();
    });
  }

  async loadFile(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 1024 * 1024) {
        this.content.setContent('File too large to preview (>1MB)');
        this.screen.render();
        return;
      }

      const raw = await fs.readFile(filePath, 'utf-8');
      // Escape curly braces so blessed doesn't parse file content as tags
      const text = raw.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
      const lines = text.split('\n');
      const numbered = lines
        .map((line, i) => {
          const num = String(i + 1).padStart(4);
          return `{cyan-fg}${num}{/cyan-fg} ${line}`;
        })
        .join('\n');

      this.box.setLabel(` View: ${path.basename(filePath)} `);
      this.content.setContent(numbered);
      this.content.scrollTo(0);
    } catch (err) {
      logger.error(`Failed to read file for preview: ${filePath}`, err);
      this.content.setContent(`Error reading file: ${(err as Error).message}`);
    }
    this.screen.render();
  }

  focus(): void {
    this.content.focus();
    this.box.show();
    this.screen.render();
  }

  close(): void {
    this.box.destroy();
    if (this.onClose) this.onClose();
    this.screen.render();
  }
}
