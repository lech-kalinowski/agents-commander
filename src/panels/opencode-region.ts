import type { VTermPlainRow } from './vterm.js';

/** Physical display cells: a wide character's continuation occupies an empty cell. */
export interface OpenCodeRegionCell {
  readonly char: string;
  readonly bg: number;
}

export interface OpenCodeRegionRow {
  readonly cells: readonly OpenCodeRegionCell[];
  readonly wrapsToNext: boolean;
  readonly startsAfterCursorMove?: boolean;
}

export type OpenCodeProtocolRegion =
  | { kind: 'full' | 'sidebar'; endColumn: number }
  | { kind: 'ambiguous'; reason: 'incomplete-grid' | 'unverified-layout' | 'sidebar-overlay' };

// OpenCode 1.18.30's Session/Sidebar layout: a 42-cell right sidebar,
// two cells of padding on each side, automatic only above 120 columns.
// https://github.com/anomalyco/opencode/blob/v1.18.30/packages/tui/src/routes/session/index.tsx
// https://github.com/anomalyco/opencode/blob/v1.18.30/packages/tui/src/routes/session/sidebar.tsx
// Do not infer a region from a COMMANDER marker or discard marker suffixes.
const SIDEBAR_COLUMNS = 42;
const WIDE_COLUMNS = 120;
const SIDEBAR_FOOTER = /^  • OpenCode 1\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)? +$/u;
// Real 1.18.30 full-width prompts leave two cells while generating and three
// while idle. Keep this bounded: an arbitrary suffix/gap is not layout proof.
const PROMPT_FOOTER = /(?:^| )[A-Za-z0-9+<>.,_-]{1,24} commands {2,3}$/u;

function cellText(cells: readonly OpenCodeRegionCell[]): string {
  return cells.map((cell) => cell.char).join('');
}

/**
 * A session-local layout recognizer, used ONLY for OpenCode's alternate screen.
 * Unrecognized/partially painted layouts fail closed at every width. Sidebar visibility
 * is not a TUI config option: its toggle persists KV state, which we never edit.
 * The caller must reset this recognizer when the child session changes.
 */
export class OpenCodeRegionDetector {
  private overlaySeen = false;

  reset(): void {
    this.overlaySeen = false;
  }

  detect(rows: readonly OpenCodeRegionRow[], columns: number): OpenCodeProtocolRegion {
    if (!Number.isSafeInteger(columns) || columns < 1 || rows.length < 4
      || rows.some((row) => row.cells.length !== columns)) {
      return { kind: 'ambiguous', reason: 'incomplete-grid' };
    }
    const footerRows = rows.slice(-4);
    const sidebarStart = columns - SIDEBAR_COLUMNS;
    const sidebarFooterSeen = sidebarStart >= 2 && footerRows.some((row) => (
      SIDEBAR_FOOTER.test(cellText(row.cells.slice(sidebarStart)))
    ));
    const fullPromptFooterSeen = footerRows.some((row) => PROMPT_FOOTER.test(cellText(row.cells)));

    if (sidebarFooterSeen) {
      if (fullPromptFooterSeen) return { kind: 'ambiguous', reason: 'unverified-layout' };
      if (columns <= WIDE_COLUMNS) {
        // The narrow sidebar overlays the transcript instead of reflowing it;
        // extracting its unobscured left fragment could execute truncated text.
        this.overlaySeen = true;
        return { kind: 'ambiguous', reason: 'sidebar-overlay' };
      }

      const background = rows[0].cells[sidebarStart].bg;
      const hasSidebarGeometry = rows.every((row) => (
        row.cells[sidebarStart - 2].char === ' '
        && row.cells[sidebarStart - 1].char === ' '
        && row.cells.slice(sidebarStart).every((cell) => cell.bg === background)
      ));
      const hasBackgroundBoundary = footerRows.some((row) => (
        row.cells[sidebarStart - 1].bg !== background
      ));
      if (hasSidebarGeometry && hasBackgroundBoundary) {
        this.overlaySeen = false;
        return { kind: 'sidebar', endColumn: sidebarStart };
      }
      return { kind: 'ambiguous', reason: 'unverified-layout' };
    }

    // A full-width main prompt places its command hint two or three cells from
    // the physical edge. A sidebar puts that hint 42 columns farther left.
    // Require this positive evidence rather than assuming an absent footer
    // means a sidebar was disabled halfway through an incremental repaint.
    // A previously valid full-width footer can survive while an overlay is
    // painted above it. Even one complete sidebar-shaped background row makes
    // that old footer insufficient proof: routing could otherwise truncate a
    // body hidden under the overlay. Do not require a blank left gutter here;
    // an overlay can cut through text. Unusual themes with this same shape
    // deliberately defer rather than guessing whether the transcript is whole.
    const sidebarBackgroundSeen = sidebarStart >= 2 && rows.some((row) => {
      const background = row.cells[sidebarStart].bg;
      return row.cells[sidebarStart - 1].bg !== background
        && row.cells.slice(sidebarStart).every((cell) => cell.bg === background);
    });
    if (sidebarBackgroundSeen) {
      if (columns <= WIDE_COLUMNS) this.overlaySeen = true;
      return { kind: 'ambiguous', reason: this.overlaySeen ? 'sidebar-overlay' : 'unverified-layout' };
    }
    if (fullPromptFooterSeen) {
      this.overlaySeen = false;
      return { kind: 'full', endColumn: columns };
    }
    // Narrow layouts also need positive full-width chrome. A fresh session can
    // start with a saved overlay before its sidebar footer has been painted.
    return { kind: 'ambiguous', reason: this.overlaySeen ? 'sidebar-overlay' : 'unverified-layout' };
  }
}

/**
 * Project every physical row through the SAME verified display-cell region.
 * Header/body/footer and echo/replay snapshots must all consume this view.
 * Null means defer, never retry with the unprojected whole-row text.
 */
export function projectOpenCodeRows(
  rows: readonly OpenCodeRegionRow[],
  region: OpenCodeProtocolRegion,
): VTermPlainRow[] | null {
  if (region.kind === 'ambiguous') return null;
  if (!Number.isSafeInteger(region.endColumn) || region.endColumn < 1) return null;
  if (rows.some((row) => row.cells.length < region.endColumn)) return null;
  return rows.map((row) => {
    // DEC wrap at the terminal's RIGHT edge belongs to the sidebar, not the
    // transcript. OpenCode performs its own transcript-column line wrapping.
    const wrapsToNext = region.kind === 'full' && row.wrapsToNext;
    const text = cellText(row.cells.slice(0, region.endColumn));
    return {
      text: wrapsToNext ? text : text.trimEnd(),
      wrapsToNext,
      ...(row.startsAfterCursorMove ? { startsAfterCursorMove: true } : {}),
    };
  });
}
