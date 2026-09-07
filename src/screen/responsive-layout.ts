export type ResponsiveLayoutDensity = 'auto' | 2 | 3 | 4;

export interface ResponsiveLayoutOptions {
  screenWidth: number;
  screenHeight: number;
  chromeRows: number;
  panelCount: number;
  density: ResponsiveLayoutDensity;
  minOuterWidth: number;
  minOuterHeight: number;
  maxVisible: number;
}

export interface ResponsivePanelRectangle {
  /** Zero-based position within the visible page. */
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ResponsiveLayout {
  rectangles: ResponsivePanelRectangle[];
  /** Rows used by the current visible panels. Zero when there are no panels. */
  rows: number;
  /** Maximum number of panels in any row of the current layout. */
  columns: number;
  /** Maximum readable panels for this screen after density and maxVisible limits. */
  capacity: number;
  visibleCount: number;
  /** True when even one panel cannot meet the configured minimum dimensions. */
  compact: boolean;
  usableWidth: number;
  usableHeight: number;
}

const DEFAULT_SCREEN_WIDTH = 80;
const DEFAULT_SCREEN_HEIGHT = 24;
const DEFAULT_MIN_OUTER_WIDTH = 40;
const DEFAULT_MIN_OUTER_HEIGHT = 10;
const MAX_SCREEN_DIMENSION = 100_000;
const MAX_PANEL_COUNT = 1_000_000;
const MAX_VISIBLE_PANELS = 4_096;

interface GridCandidate {
  rows: number;
  columns: number;
  scale: number;
  emptySlots: number;
  aspectError: number;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function normalizeDensity(value: unknown): ResponsiveLayoutDensity {
  return value === 2 || value === 3 || value === 4 ? value : 'auto';
}

function isBetterGrid(candidate: GridCandidate, best: GridCandidate | null): boolean {
  if (!best) return true;

  const epsilon = 1e-12;
  if (candidate.scale > best.scale + epsilon) return true;
  if (candidate.scale < best.scale - epsilon) return false;
  if (candidate.emptySlots !== best.emptySlots) {
    return candidate.emptySlots < best.emptySlots;
  }
  if (candidate.aspectError < best.aspectError - epsilon) return true;
  if (candidate.aspectError > best.aspectError + epsilon) return false;
  if (candidate.rows !== best.rows) return candidate.rows < best.rows;
  return candidate.columns < best.columns;
}

function chooseGrid(
  visibleCount: number,
  usableWidth: number,
  usableHeight: number,
  minOuterWidth: number,
  minOuterHeight: number,
  maxReadableColumns: number,
  maxReadableRows: number,
): { rows: number; columns: number } {
  let best: GridCandidate | null = null;
  const targetAspect = minOuterWidth / minOuterHeight;
  const rowLimit = Math.min(visibleCount, maxReadableRows);

  for (let rows = 1; rows <= rowLimit; rows++) {
    const columns = Math.ceil(visibleCount / rows);
    if (columns > maxReadableColumns) continue;

    const cellWidth = usableWidth / columns;
    const cellHeight = usableHeight / rows;
    const cellAspect = cellWidth / cellHeight;
    const candidate: GridCandidate = {
      rows,
      columns,
      scale: Math.min(cellWidth / minOuterWidth, cellHeight / minOuterHeight),
      emptySlots: rows * columns - visibleCount,
      aspectError: Math.abs(Math.log(cellAspect / targetAspect)),
    };

    if (isBetterGrid(candidate, best)) best = candidate;
  }

  // visibleCount is bounded by readable capacity, so a candidate should always
  // exist. Keep the fallback defensive for malformed future callers.
  return best
    ? { rows: best.rows, columns: best.columns }
    : { rows: 1, columns: 1 };
}

function partitionLength(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function panelsPerRow(panelCount: number, rows: number): number[] {
  const base = Math.floor(panelCount / rows);
  const remainder = panelCount % rows;
  return Array.from({ length: rows }, (_, index) => base + (index < remainder ? 1 : 0));
}

function tileRectangles(
  visibleCount: number,
  rows: number,
  usableWidth: number,
  usableHeight: number,
): ResponsivePanelRectangle[] {
  const rowHeights = partitionLength(usableHeight, rows);
  const rowCounts = panelsPerRow(visibleCount, rows);
  const rectangles: ResponsivePanelRectangle[] = [];
  let top = 0;

  for (let row = 0; row < rows; row++) {
    const height = rowHeights[row];
    const widths = partitionLength(usableWidth, rowCounts[row]);
    let left = 0;

    for (const width of widths) {
      rectangles.push({
        index: rectangles.length,
        top,
        left,
        width,
        height,
      });
      left += width;
    }

    top += height;
  }

  return rectangles;
}

/**
 * Calculate a responsive, row-major terminal layout without touching Blessed.
 *
 * Auto density exposes every readable slot up to maxVisible. Numeric densities
 * cap that capacity at two, three, or four visible panels. When the screen is
 * smaller than one configured panel, a single compact rectangle fills the
 * usable area. Rows with fewer panels expand their cells so the returned
 * rectangles always tile the complete usable area without gaps.
 */
export function calculateResponsiveLayout(
  options: Readonly<ResponsiveLayoutOptions>,
): ResponsiveLayout {
  const screenWidth = boundedInteger(
    options?.screenWidth,
    DEFAULT_SCREEN_WIDTH,
    1,
    MAX_SCREEN_DIMENSION,
  );
  const screenHeight = boundedInteger(
    options?.screenHeight,
    DEFAULT_SCREEN_HEIGHT,
    1,
    MAX_SCREEN_DIMENSION,
  );
  const chromeRows = boundedInteger(options?.chromeRows, 0, 0, screenHeight - 1);
  const usableWidth = screenWidth;
  const usableHeight = Math.max(1, screenHeight - chromeRows);
  const panelCount = boundedInteger(options?.panelCount, 0, 0, MAX_PANEL_COUNT);
  const minOuterWidth = boundedInteger(
    options?.minOuterWidth,
    DEFAULT_MIN_OUTER_WIDTH,
    1,
    MAX_SCREEN_DIMENSION,
  );
  const minOuterHeight = boundedInteger(
    options?.minOuterHeight,
    DEFAULT_MIN_OUTER_HEIGHT,
    1,
    MAX_SCREEN_DIMENSION,
  );
  const maxVisible = boundedInteger(
    options?.maxVisible,
    MAX_VISIBLE_PANELS,
    1,
    MAX_VISIBLE_PANELS,
  );
  const density = normalizeDensity(options?.density);

  const maxReadableColumns = Math.floor(usableWidth / minOuterWidth);
  const maxReadableRows = Math.floor(usableHeight / minOuterHeight);
  const compact = maxReadableColumns < 1 || maxReadableRows < 1;
  const densityLimit = density === 'auto' ? maxVisible : Math.min(density, maxVisible);
  const readableCapacity = compact
    ? 1
    : Math.min(
      MAX_VISIBLE_PANELS,
      maxReadableColumns * maxReadableRows,
    );
  const capacity = Math.max(1, Math.min(readableCapacity, densityLimit));
  const visibleCount = Math.min(panelCount, capacity);

  if (visibleCount === 0) {
    return {
      rectangles: [],
      rows: 0,
      columns: 0,
      capacity,
      visibleCount,
      compact,
      usableWidth,
      usableHeight,
    };
  }

  if (compact) {
    return {
      rectangles: [{
        index: 0,
        top: 0,
        left: 0,
        width: usableWidth,
        height: usableHeight,
      }],
      rows: 1,
      columns: 1,
      capacity: 1,
      visibleCount: 1,
      compact: true,
      usableWidth,
      usableHeight,
    };
  }

  const grid = chooseGrid(
    visibleCount,
    usableWidth,
    usableHeight,
    minOuterWidth,
    minOuterHeight,
    maxReadableColumns,
    maxReadableRows,
  );

  return {
    rectangles: tileRectangles(
      visibleCount,
      grid.rows,
      usableWidth,
      usableHeight,
    ),
    rows: grid.rows,
    columns: grid.columns,
    capacity,
    visibleCount,
    compact: false,
    usableWidth,
    usableHeight,
  };
}
