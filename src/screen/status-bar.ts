import blessed from 'blessed';
import type { Theme } from '../config/types.js';
import { formatFileSize } from '../utils/format.js';

export function createStatusBar(parent: blessed.Widgets.Screen, theme: Theme): blessed.Widgets.BoxElement {
  return blessed.box({
    parent,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: {
      bg: theme.statusBar.bg,
      fg: theme.statusBar.fg,
    },
    content: '',
  });
}

export function updateStatusBar(
  bar: blessed.Widgets.BoxElement,
  info: {
    fileName?: string;
    fileSize?: number;
    fileDate?: string;
    dirPath?: string;
    fileCount?: number;
    dirCount?: number;
    selectedCount?: number;
  },
): void {
  const parts: string[] = [];

  if (info.fileName) {
    parts.push(info.fileName);
  }
  if (info.fileSize !== undefined) {
    parts.push(formatFileSize(info.fileSize));
  }
  if (info.fileDate) {
    parts.push(info.fileDate);
  }

  const left = parts.join('  ');

  const rightParts: string[] = [];
  if (info.selectedCount && info.selectedCount > 0) {
    rightParts.push(`${info.selectedCount} selected`);
  }
  if (info.fileCount !== undefined) {
    rightParts.push(`${info.fileCount} files`);
  }
  if (info.dirCount !== undefined) {
    rightParts.push(`${info.dirCount} dirs`);
  }
  const right = rightParts.join(' | ');

  const width = (bar.width as number) || 80;
  const padding = Math.max(1, width - left.length - right.length);
  bar.setContent(left + ' '.repeat(padding) + right);
}
