import blessed from 'blessed';
import type { Theme } from '../config/types.js';
import { formatFileSize } from '../utils/format.js';
import { sanitizeUserText } from '../utils/user-facing-errors.js';
import {
  isActivePanelCount,
  isPanelDensity,
  isPanelNumber,
  type PanelDensity,
} from '../panel-limits.js';

const FALLBACK_STATUS_WIDTH = 80;
const MAX_STATUS_WIDTH = 10_000;
const MAX_STATUS_COUNT = 1_000_000;

export interface StatusBarInfo {
  /** Recording status takes precedence over other metadata on narrow terminals. */
  captureLabel?: 'REC:METADATA' | 'REC:PROTOCOL' | 'REC:INCOMPLETE';
  captureEvents?: number;
  modeLabel?: string;
  warning?: string;
  fileName?: string;
  fileSize?: number;
  fileDate?: string;
  dirPath?: string;
  fileCount?: number;
  dirCount?: number;
  selectedCount?: number;
  /** Stable, one-based public panel number (for example, P101). */
  panelNumber?: number;
  /** Number of live panels retained in the workspace. */
  panelCount?: number;
  /** One-based page containing the active panel. */
  pageNumber?: number;
  pageCount?: number;
  density?: PanelDensity;
}

function boundedStatusWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return FALLBACK_STATUS_WIDTH;
  return Math.max(1, Math.min(MAX_STATUS_WIDTH, Math.floor(value)));
}

function isDisplayCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_STATUS_COUNT;
}

function truncateStatusText(value: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  if (value.length <= maxLength) return value;
  if (maxLength === 1) return value.slice(0, 1);
  return `${value.slice(0, maxLength - 1)}…`;
}

function composeStatusLine(left: string, right: string, width: number): string {
  if (!right) return truncateStatusText(left, width).padEnd(width);
  if (!left) {
    const boundedRight = truncateStatusText(right, width);
    return boundedRight.padStart(width);
  }
  if (right.length >= width) return truncateStatusText(right, width);

  const availableLeft = width - right.length - 1;
  const boundedLeft = truncateStatusText(left, availableLeft);
  const padding = Math.max(1, width - boundedLeft.length - right.length);
  return boundedLeft + ' '.repeat(padding) + right;
}

export function createStatusBar(parent: blessed.Widgets.Screen, theme: Theme): blessed.Widgets.BoxElement {
  return blessed.box({
    parent,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    tags: false,
    style: {
      bg: theme.statusBar.bg,
      fg: theme.statusBar.fg,
    },
    content: '',
  });
}

export function updateStatusBar(
  bar: blessed.Widgets.BoxElement,
  info: StatusBarInfo,
): void {
  const parts: string[] = [];

  if (info.modeLabel) {
    parts.push(`[${sanitizeUserText(info.modeLabel, 40)}]`);
  }
  if (info.warning) {
    parts.push(`! ${sanitizeUserText(info.warning, 120)}`);
  }
  if (info.fileName) {
    parts.push(sanitizeUserText(info.fileName, 160));
  }
  if (typeof info.fileSize === 'number' && Number.isFinite(info.fileSize) && info.fileSize >= 0) {
    parts.push(formatFileSize(info.fileSize));
  }
  if (info.fileDate) {
    parts.push(sanitizeUserText(info.fileDate, 80));
  }

  const left = parts.join('  ');

  const rightParts: string[] = [];
  if (['REC:METADATA', 'REC:PROTOCOL', 'REC:INCOMPLETE'].includes(info.captureLabel ?? '')) {
    rightParts.push(info.captureLabel!);
    if (isDisplayCount(info.captureEvents)) rightParts.push(`${info.captureEvents} events`);
  }
  if (isPanelNumber(info.panelNumber)) {
    rightParts.push(`P${info.panelNumber}`);
  }
  if (isActivePanelCount(info.panelCount)) {
    rightParts.push(`${info.panelCount} panel${info.panelCount === 1 ? '' : 's'}`);
  }
  if (
    isActivePanelCount(info.pageNumber)
    && isActivePanelCount(info.pageCount)
    && info.pageNumber <= info.pageCount
  ) {
    rightParts.push(`Page ${info.pageNumber}/${info.pageCount}`);
  }
  if (isPanelDensity(info.density)) {
    rightParts.push(`Density ${info.density}`);
  }
  if (isDisplayCount(info.selectedCount) && info.selectedCount > 0) {
    rightParts.push(`${info.selectedCount} selected`);
  }
  if (isDisplayCount(info.fileCount)) {
    rightParts.push(`${info.fileCount} files`);
  }
  if (isDisplayCount(info.dirCount)) {
    rightParts.push(`${info.dirCount} dirs`);
  }
  const right = rightParts.join(' | ');

  const width = boundedStatusWidth(bar.width);
  bar.setContent(composeStatusLine(left, right, width));
}
