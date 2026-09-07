import {
  MAX_ACTIVE_PANELS,
  isPanelId,
} from '../../panel-limits.js';

/**
 * Dialogs receive ordered stable panel IDs. A count remains accepted so older
 * callers continue to mean the dense IDs 0..count-1 during migration.
 */
export type PanelPickerSource = number | readonly number[];

export interface PanelPickerWindow {
  panelIds: readonly number[];
  selectedIndex: number;
  startIndex: number;
  endIndex: number;
  visiblePanelIds: readonly number[];
}

export interface PanelNumberInputState {
  digits: string;
  updatedAt: number;
}

export interface PanelNumberInputResult {
  state: PanelNumberInputState;
  panelId: number | null;
}

export const PANEL_NUMBER_INPUT_TIMEOUT_MS = 900;

/**
 * Shared multi-digit input buffer for every panel-target dialog. It clears the
 * visual prefix after the input window and distinguishes an unfinished sparse
 * prefix (for example `1` when only P5 and P12 exist) from a confirmable panel.
 */
export class PanelNumberInputBuffer {
  private state: PanelNumberInputState = { digits: '', updatedAt: 0 };
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly source: PanelPickerSource,
    private readonly onExpire: () => void,
  ) {}

  get digits(): string {
    return this.state.digits;
  }

  get canConfirm(): boolean {
    if (!this.state.digits) return true;
    return panelIdForNumber(Number.parseInt(this.state.digits, 10), this.source) !== null;
  }

  acceptDigit(digit: string, now = Date.now()): number | null {
    const result = acceptPanelNumberDigit(digit, this.source, this.state, now);
    this.state = result.state;
    this.armExpiry();
    return result.panelId;
  }

  reset(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.state = { digits: '', updatedAt: 0 };
  }

  dispose(): void {
    this.reset();
  }

  private armExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!this.state.digits) return;

    const generation = this.state.updatedAt;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      if (this.state.updatedAt !== generation) return;
      this.state = { digits: '', updatedAt: 0 };
      this.onExpire();
    }, PANEL_NUMBER_INPUT_TIMEOUT_MS + 1);
  }
}

/** Normalize without changing the order chosen by the workspace. */
export function normalizePanelIds(source: PanelPickerSource): number[] {
  if (typeof source === 'number') {
    if (!Number.isInteger(source) || source < 1) return [];
    const count = Math.min(source, MAX_ACTIVE_PANELS);
    return Array.from({ length: count }, (_, panelId) => panelId);
  }

  const panelIds: number[] = [];
  const seen = new Set<number>();
  for (const panelId of source) {
    if (!isPanelId(panelId) || seen.has(panelId)) continue;
    seen.add(panelId);
    panelIds.push(panelId);
    if (panelIds.length === MAX_ACTIVE_PANELS) break;
  }
  return panelIds;
}

export function initialPanelId(
  source: PanelPickerSource,
  preferredPanelId: number,
): number | null {
  const panelIds = normalizePanelIds(source);
  if (panelIds.includes(preferredPanelId)) return preferredPanelId;
  return panelIds[0] ?? null;
}

/** Select the adjacent live ID in workspace order, wrapping at both ends. */
export function adjacentPanelId(
  source: PanelPickerSource,
  selectedPanelId: number,
  direction: -1 | 1,
): number | null {
  const panelIds = normalizePanelIds(source);
  if (panelIds.length === 0) return null;
  const selectedIndex = panelIds.indexOf(selectedPanelId);
  if (selectedIndex < 0) return panelIds[0];
  const nextIndex = (selectedIndex + direction + panelIds.length) % panelIds.length;
  return panelIds[nextIndex];
}

/** Resolve a user-facing P-number to a live stable ID. */
export function panelIdForNumber(
  panelNumber: number,
  source: PanelPickerSource,
): number | null {
  if (!Number.isSafeInteger(panelNumber) || panelNumber < 1) return null;
  const panelId = panelNumber - 1;
  return normalizePanelIds(source).includes(panelId) ? panelId : null;
}

export function isValidPanelNumber(
  panelNumber: number,
  source: PanelPickerSource,
): boolean {
  return panelIdForNumber(panelNumber, source) !== null;
}

/**
 * Accumulate a multi-digit public panel number without making single-digit
 * jumps slower. Exact live matches select immediately, while a live prefix is
 * retained briefly so typing `1`, `0`, `0` reaches P100.
 */
export function acceptPanelNumberDigit(
  digit: string,
  source: PanelPickerSource,
  previous: PanelNumberInputState = { digits: '', updatedAt: 0 },
  now = Date.now(),
): PanelNumberInputResult {
  if (!/^\d$/u.test(digit)) {
    return { state: previous, panelId: null };
  }

  const panelIds = normalizePanelIds(source);
  const publicNumbers = panelIds.map((panelId) => String(panelId + 1));
  const withinWindow = now - previous.updatedAt <= PANEL_NUMBER_INPUT_TIMEOUT_MS;
  let digits = `${withinWindow ? previous.digits : ''}${digit}`;

  if (!publicNumbers.some((panelNumber) => panelNumber.startsWith(digits))) {
    digits = publicNumbers.some((panelNumber) => panelNumber.startsWith(digit))
      ? digit
      : '';
  }

  const panelId = digits
    ? panelIdForNumber(Number.parseInt(digits, 10), panelIds)
    : null;
  return {
    state: { digits, updatedAt: now },
    panelId,
  };
}

/** Choose a readable label count for the actual content width. */
export function panelLabelsForWidth(
  source: PanelPickerSource,
  availableWidth: number,
  maximum = 4,
): number {
  const panelIds = normalizePanelIds(source);
  const widestLabel = panelIds.reduce(
    (width, panelId) => Math.max(width, `P${panelId + 1}`.length),
    2,
  );
  const width = Number.isFinite(availableWidth)
    ? Math.max(12, Math.trunc(availableWidth))
    : 80;
  const perLabel = widestLabel + 4;
  const chrome = 12;
  return Math.max(1, Math.min(maximum, Math.floor((width - chrome) / perLabel)));
}

/** Build a bounded display window centered as closely as possible on selection. */
export function getPanelPickerWindow(
  selectedPanelId: number,
  source: PanelPickerSource,
  maxVisible = 4,
): PanelPickerWindow {
  const panelIds = normalizePanelIds(source);
  const selectedIndex = Math.max(0, panelIds.indexOf(selectedPanelId));
  const visibleCount = Math.max(
    1,
    Math.min(
      panelIds.length || 1,
      Number.isFinite(maxVisible) ? Math.trunc(maxVisible) : 4,
    ),
  );
  const centeredStart = selectedIndex - Math.floor((visibleCount - 1) / 2);
  const startIndex = Math.max(
    0,
    Math.min(centeredStart, Math.max(0, panelIds.length - visibleCount)),
  );
  const endIndex = Math.min(panelIds.length, startIndex + visibleCount);

  return {
    panelIds,
    selectedIndex,
    startIndex,
    endIndex,
    visiblePanelIds: panelIds.slice(startIndex, endIndex),
  };
}

/**
 * Render a compact, bounded picker. Panel labels are stable public numbers
 * (panelId + 1), while the second line makes workspace position explicit.
 */
export function renderPanelBoxes(
  selectedPanelId: number,
  source: PanelPickerSource,
  maxVisible = 4,
  availableWidth = 80,
  numberInput = '',
): string {
  const visibleLimit = panelLabelsForWidth(source, availableWidth, maxVisible);
  const window = getPanelPickerWindow(selectedPanelId, source, visibleLimit);
  if (window.panelIds.length === 0) return '  No panels available';

  const selectedId = window.panelIds[window.selectedIndex];
  const targets = window.visiblePanelIds.map((panelId) => {
    const label = `P${panelId + 1}`;
    return panelId === selectedId
      ? `{black-fg}{cyan-bg}{bold} ${label} {/bold}{/cyan-bg}{/black-fg}`
      : `{white-fg} ${label} {/white-fg}`;
  });
  const before = window.startIndex > 0 ? '…  ' : '';
  const after = window.endIndex < window.panelIds.length ? '  …' : '';

  const summary = numberInput
    ? `  Jump: P${numberInput}…`
    : availableWidth < 48
      ? `  P${selectedId + 1}  ·  ${window.selectedIndex + 1}/${window.panelIds.length}`
      : `  Target P${selectedId + 1}  ·  ${window.selectedIndex + 1}/${window.panelIds.length} in workspace`;

  return [
    `  ←  ${before}${targets.join('  ')}${after}  →`,
    summary,
  ].join('\n');
}
