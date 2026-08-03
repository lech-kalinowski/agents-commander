import { describe, expect, it } from 'vitest';
import {
  calculateResponsiveLayout,
  type ResponsiveLayout,
  type ResponsiveLayoutOptions,
} from '../../src/screen/responsive-layout.js';

const baseOptions: ResponsiveLayoutOptions = {
  screenWidth: 120,
  screenHeight: 40,
  chromeRows: 3,
  panelCount: 1,
  density: 'auto',
  minOuterWidth: 40,
  minOuterHeight: 10,
  maxVisible: 100,
};

function layout(overrides: Partial<ResponsiveLayoutOptions> = {}): ResponsiveLayout {
  return calculateResponsiveLayout({ ...baseOptions, ...overrides });
}

function expectExactTiling(result: ResponsiveLayout): void {
  const { rectangles, usableWidth, usableHeight } = result;

  for (const [index, rectangle] of rectangles.entries()) {
    expect(rectangle.index).toBe(index);
    expect(Number.isInteger(rectangle.top)).toBe(true);
    expect(Number.isInteger(rectangle.left)).toBe(true);
    expect(Number.isInteger(rectangle.width)).toBe(true);
    expect(Number.isInteger(rectangle.height)).toBe(true);
    expect(rectangle.top).toBeGreaterThanOrEqual(0);
    expect(rectangle.left).toBeGreaterThanOrEqual(0);
    expect(rectangle.width).toBeGreaterThan(0);
    expect(rectangle.height).toBeGreaterThan(0);
    expect(rectangle.left + rectangle.width).toBeLessThanOrEqual(usableWidth);
    expect(rectangle.top + rectangle.height).toBeLessThanOrEqual(usableHeight);
  }

  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex++) {
    const left = rectangles[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex++) {
      const right = rectangles[rightIndex];
      const overlapsHorizontally = left.left < right.left + right.width
        && right.left < left.left + left.width;
      const overlapsVertically = left.top < right.top + right.height
        && right.top < left.top + left.height;
      expect(overlapsHorizontally && overlapsVertically).toBe(false);
    }
  }

  const coveredArea = rectangles.reduce(
    (sum, rectangle) => sum + rectangle.width * rectangle.height,
    0,
  );
  expect(coveredArea).toBe(usableWidth * usableHeight);
}

function expectReadableMinimums(
  result: ResponsiveLayout,
  minWidth: number,
  minHeight: number,
): void {
  expect(result.compact).toBe(false);
  for (const rectangle of result.rectangles) {
    expect(rectangle.width).toBeGreaterThanOrEqual(minWidth);
    expect(rectangle.height).toBeGreaterThanOrEqual(minHeight);
  }
}

describe('calculateResponsiveLayout', () => {
  it('gives one panel the entire usable rectangle', () => {
    const result = layout({ panelCount: 1 });

    expect(result).toMatchObject({
      rows: 1,
      columns: 1,
      capacity: 9,
      visibleCount: 1,
      compact: false,
      usableWidth: 120,
      usableHeight: 37,
    });
    expect(result.rectangles).toEqual([
      { index: 0, top: 0, left: 0, width: 120, height: 37 },
    ]);
    expectExactTiling(result);
  });

  it.each([3, 4])('tiles an irregular %i-panel layout without gaps', (panelCount) => {
    const result = layout({
      screenWidth: 101,
      screenHeight: 31,
      chromeRows: 1,
      panelCount,
      minOuterWidth: 30,
      minOuterHeight: 10,
    });

    expect(result.visibleCount).toBe(panelCount);
    expect(result.rows).toBe(2);
    expect(result.columns).toBe(2);
    expect(result.rectangles).toHaveLength(panelCount);
    expectExactTiling(result);
    expectReadableMinimums(result, 30, 10);
  });

  it('maximizes readable auto capacity for 25 panels', () => {
    const result = layout({
      screenWidth: 200,
      screenHeight: 55,
      chromeRows: 5,
      panelCount: 25,
      minOuterWidth: 40,
      minOuterHeight: 10,
    });

    expect(result).toMatchObject({
      rows: 5,
      columns: 5,
      capacity: 25,
      visibleCount: 25,
      compact: false,
    });
    expectExactTiling(result);
    expectReadableMinimums(result, 40, 10);
  });

  it('supports a full 100-panel readable page', () => {
    const result = layout({
      screenWidth: 200,
      screenHeight: 100,
      chromeRows: 0,
      panelCount: 100,
      minOuterWidth: 20,
      minOuterHeight: 10,
      maxVisible: 100,
    });

    expect(result).toMatchObject({
      rows: 10,
      columns: 10,
      capacity: 100,
      visibleCount: 100,
      compact: false,
    });
    expectExactTiling(result);
    expectReadableMinimums(result, 20, 10);
  });

  it.each([
    [2, 2],
    [3, 3],
    [4, 4],
  ] as const)('caps density %i at %i visible panels', (density, expected) => {
    const result = layout({
      screenWidth: 240,
      screenHeight: 80,
      chromeRows: 0,
      panelCount: 100,
      density,
      minOuterWidth: 20,
      minOuterHeight: 10,
      maxVisible: 100,
    });

    expect(result.capacity).toBe(expected);
    expect(result.visibleCount).toBe(expected);
    expect(result.rectangles).toHaveLength(expected);
    expectExactTiling(result);
    expectReadableMinimums(result, 20, 10);
  });

  it('honors maxVisible below the readable auto capacity', () => {
    const result = layout({
      screenWidth: 240,
      screenHeight: 80,
      chromeRows: 0,
      panelCount: 100,
      minOuterWidth: 20,
      minOuterHeight: 10,
      maxVisible: 7,
    });

    expect(result.capacity).toBe(7);
    expect(result.visibleCount).toBe(7);
    expectExactTiling(result);
  });

  it('changes capacity exactly at readable width and height boundaries', () => {
    expect(layout({
      screenWidth: 80,
      screenHeight: 22,
      chromeRows: 2,
      panelCount: 100,
    }).capacity).toBe(4);

    expect(layout({
      screenWidth: 79,
      screenHeight: 22,
      chromeRows: 2,
      panelCount: 100,
    }).capacity).toBe(2);

    expect(layout({
      screenWidth: 80,
      screenHeight: 21,
      chromeRows: 2,
      panelCount: 100,
    }).capacity).toBe(2);
  });

  it('uses a one-panel compact fallback when minimum size cannot fit', () => {
    const result = layout({
      screenWidth: 20,
      screenHeight: 5,
      chromeRows: 4,
      panelCount: 25,
      minOuterWidth: 40,
      minOuterHeight: 10,
    });

    expect(result).toMatchObject({
      rows: 1,
      columns: 1,
      capacity: 1,
      visibleCount: 1,
      compact: true,
      usableWidth: 20,
      usableHeight: 1,
    });
    expect(result.rectangles).toEqual([
      { index: 0, top: 0, left: 0, width: 20, height: 1 },
    ]);
    expectExactTiling(result);
  });

  it('uses quotient/remainder distribution for odd dimensions', () => {
    const result = layout({
      screenWidth: 101,
      screenHeight: 32,
      chromeRows: 1,
      panelCount: 4,
      minOuterWidth: 40,
      minOuterHeight: 10,
      maxVisible: 4,
    });

    expect(result.rectangles.map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 51, height: 16 },
      { width: 50, height: 16 },
      { width: 51, height: 15 },
      { width: 50, height: 15 },
    ]);
    expectExactTiling(result);
  });

  it('normalizes malformed inputs without zero-sized or unbounded output', () => {
    const empty = calculateResponsiveLayout({
      screenWidth: Number.NaN,
      screenHeight: Number.POSITIVE_INFINITY,
      chromeRows: -50,
      panelCount: -10,
      density: 'invalid' as never,
      minOuterWidth: 0,
      minOuterHeight: Number.NaN,
      maxVisible: 0,
    });

    expect(empty.rectangles).toEqual([]);
    expect(empty.visibleCount).toBe(0);
    expect(empty.capacity).toBeGreaterThanOrEqual(1);
    expect(empty.usableWidth).toBeGreaterThanOrEqual(1);
    expect(empty.usableHeight).toBeGreaterThanOrEqual(1);

    const bounded = calculateResponsiveLayout({
      screenWidth: Number.MAX_VALUE,
      screenHeight: Number.MAX_VALUE,
      chromeRows: Number.MAX_VALUE,
      panelCount: Number.MAX_VALUE,
      density: 'auto',
      minOuterWidth: 1,
      minOuterHeight: 1,
      maxVisible: Number.MAX_VALUE,
    });

    expect(bounded.visibleCount).toBeLessThanOrEqual(4_096);
    expect(bounded.rectangles).toHaveLength(bounded.visibleCount);
    expect(bounded.usableWidth).toBeLessThanOrEqual(100_000);
    expect(bounded.usableHeight).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic for identical inputs', () => {
    const options = {
      ...baseOptions,
      screenWidth: 137,
      screenHeight: 47,
      panelCount: 25,
      maxVisible: 13,
    };

    expect(calculateResponsiveLayout(options)).toEqual(calculateResponsiveLayout(options));
  });
});
