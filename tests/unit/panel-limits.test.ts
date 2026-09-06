import { describe, expect, it } from 'vitest';
import {
  MAX_ACTIVE_PANELS,
  MAX_PANEL_ID,
  MAX_PANEL_NUMBER,
  isActivePanelCount,
  isPanelDensity,
  isPanelId,
  isPanelNumber,
  parseActivePanelCount,
  parsePanelDensity,
} from '../../src/panel-limits.js';

describe('panel limits', () => {
  it('bounds active workspace panels to 1..100', () => {
    expect(MAX_ACTIVE_PANELS).toBe(100);
    expect(isActivePanelCount(1)).toBe(true);
    expect(isActivePanelCount(100)).toBe(true);
    expect(isActivePanelCount(0)).toBe(false);
    expect(isActivePanelCount(101)).toBe(false);
    expect(isActivePanelCount(2.5)).toBe(false);
  });

  it('bounds internal stable panel IDs independently at 0..999999', () => {
    expect(MAX_PANEL_ID).toBe(999_999);
    expect(isPanelId(0)).toBe(true);
    expect(isPanelId(MAX_PANEL_ID)).toBe(true);
    expect(isPanelId(-1)).toBe(false);
    expect(isPanelId(MAX_PANEL_ID + 1)).toBe(false);
  });

  it('bounds user-facing panel numbers at 1..1000000', () => {
    expect(MAX_PANEL_NUMBER).toBe(1_000_000);
    expect(isPanelNumber(1)).toBe(true);
    expect(isPanelNumber(MAX_PANEL_NUMBER)).toBe(true);
    expect(isPanelNumber(0)).toBe(false);
    expect(isPanelNumber(MAX_PANEL_NUMBER + 1)).toBe(false);
  });

  it.each([
    ['1', 1],
    ['42', 42],
    ['100', 100],
  ] as const)('parses canonical --panels value %s', (input, expected) => {
    expect(parseActivePanelCount(input)).toBe(expected);
  });

  it.each(['0', '01', '101', '2.5', 'auto', ''])('rejects invalid --panels value %j', (input) => {
    expect(parseActivePanelCount(input)).toBeNull();
  });

  it.each([
    ['auto', 'auto'],
    ['2', 2],
    ['3', 3],
    ['4', 4],
  ] as const)('parses --density value %s', (input, expected) => {
    expect(parsePanelDensity(input)).toBe(expected);
    expect(isPanelDensity(expected)).toBe(true);
  });

  it.each(['1', '5', 'AUTO', 'dense', ''])('rejects invalid --density value %j', (input) => {
    expect(parsePanelDensity(input)).toBeNull();
  });
});
