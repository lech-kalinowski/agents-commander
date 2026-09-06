/** Minimum number of panels kept in an active workspace. */
export const MIN_ACTIVE_PANELS = 1;

/** Hard resource boundary for panels kept in an active workspace. */
export const MAX_ACTIVE_PANELS = 100;

/** Internal stable panel IDs are zero-based, monotonic, and never reused. */
export const MIN_PANEL_ID = 0;
export const MAX_PANEL_ID = 999_999;

/** User-facing and protocol panel numbers are the one-based form of panel IDs. */
export const MIN_PANEL_NUMBER = 1;
export const MAX_PANEL_NUMBER = 1_000_000;

/** `auto` is responsive; numeric values cap the visible density. */
export type PanelDensity = 'auto' | 2 | 3 | 4;

export function isActivePanelCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_ACTIVE_PANELS
    && value <= MAX_ACTIVE_PANELS;
}

export function isPanelId(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= MIN_PANEL_ID
    && value <= MAX_PANEL_ID;
}

export function isPanelNumber(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= MIN_PANEL_NUMBER
    && value <= MAX_PANEL_NUMBER;
}

export function isPanelDensity(value: unknown): value is PanelDensity {
  return value === 'auto' || value === 2 || value === 3 || value === 4;
}

/** Parse the canonical decimal form accepted by `--panels`. */
export function parseActivePanelCount(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return isActivePanelCount(parsed) ? parsed : null;
}

/** Parse the exact view-density presets accepted by `--density`. */
export function parsePanelDensity(value: string): PanelDensity | null {
  if (value === 'auto') return value;
  if (!/^[234]$/u.test(value)) return null;
  const parsed = Number(value);
  return isPanelDensity(parsed) ? parsed : null;
}
