import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptPanelNumberDigit,
  adjacentPanelId,
  getPanelPickerWindow,
  initialPanelId,
  isValidPanelNumber,
  normalizePanelIds,
  PANEL_NUMBER_INPUT_TIMEOUT_MS,
  PanelNumberInputBuffer,
  panelLabelsForWidth,
  panelIdForNumber,
  renderPanelBoxes,
} from '../../src/screen/dialog/panel-picker.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('panel picker stable IDs', () => {
  it.each([
    [2, [1, 2], [0, 3, 4]],
    [3, [1, 2, 3], [0, 4]],
    [4, [1, 2, 3, 4], [0, 5]],
  ])('keeps dense panel-count callers backward compatible for %i panels', (
    panelCount,
    valid,
    invalid,
  ) => {
    for (const panel of valid) {
      expect(isValidPanelNumber(panel, panelCount)).toBe(true);
    }
    for (const panel of invalid) {
      expect(isValidPanelNumber(panel, panelCount)).toBe(false);
    }
  });

  it('preserves ordered sparse IDs and resolves only live public panel numbers', () => {
    const panelIds = [0, 2, 9, 99];

    expect(normalizePanelIds(panelIds)).toEqual(panelIds);
    expect(initialPanelId(panelIds, 9)).toBe(9);
    expect(initialPanelId(panelIds, 1)).toBe(0);
    expect(panelIdForNumber(1, panelIds)).toBe(0);
    expect(panelIdForNumber(3, panelIds)).toBe(2);
    expect(panelIdForNumber(10, panelIds)).toBe(9);
    expect(panelIdForNumber(100, panelIds)).toBe(99);
    expect(panelIdForNumber(2, panelIds)).toBeNull();
  });

  it('reaches sparse and multi-digit panel IDs with wrapping arrow navigation', () => {
    const panelIds = [0, 2, 9, 99];

    expect(adjacentPanelId(panelIds, 0, 1)).toBe(2);
    expect(adjacentPanelId(panelIds, 2, 1)).toBe(9);
    expect(adjacentPanelId(panelIds, 9, 1)).toBe(99);
    expect(adjacentPanelId(panelIds, 99, 1)).toBe(0);
    expect(adjacentPanelId(panelIds, 0, -1)).toBe(99);
  });

  it('accepts multi-digit P-numbers while preserving immediate exact jumps', () => {
    const panelIds = [0, 9, 99];
    let result = acceptPanelNumberDigit('1', panelIds, undefined, 1_000);
    expect(result.panelId).toBe(0);

    result = acceptPanelNumberDigit('0', panelIds, result.state, 1_200);
    expect(result.panelId).toBe(9);

    result = acceptPanelNumberDigit('0', panelIds, result.state, 1_400);
    expect(result.panelId).toBe(99);
    expect(result.state.digits).toBe('100');
  });

  it('expires stale numeric prefixes and retains prefixes for sparse targets', () => {
    const panelIds = [9, 99];
    const prefix = acceptPanelNumberDigit('1', panelIds, undefined, 1_000);
    expect(prefix.panelId).toBeNull();
    expect(prefix.state.digits).toBe('1');

    const p10 = acceptPanelNumberDigit('0', panelIds, prefix.state, 1_200);
    expect(p10.panelId).toBe(9);

    const expired = acceptPanelNumberDigit('0', panelIds, p10.state, 2_200);
    expect(expired).toMatchObject({
      panelId: null,
      state: { digits: '' },
    });
  });

  it('blocks confirmation for an unresolved sparse prefix and clears it visibly', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const input = new PanelNumberInputBuffer([4, 11], onExpire);

    expect(input.acceptDigit('1')).toBeNull();
    expect(input.digits).toBe('1');
    expect(input.canConfirm).toBe(false);

    vi.advanceTimersByTime(PANEL_NUMBER_INPUT_TIMEOUT_MS + 1);

    expect(input.digits).toBe('');
    expect(input.canConfirm).toBe(true);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('allows an exact sparse panel number and cancels expiry on disposal', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const input = new PanelNumberInputBuffer([4, 11], onExpire);

    expect(input.acceptDigit('1')).toBeNull();
    expect(input.acceptDigit('2')).toBe(11);
    expect(input.canConfirm).toBe(true);
    input.dispose();
    vi.runAllTimers();

    expect(onExpire).not.toHaveBeenCalled();
  });

  it('renders a compact moving window instead of all 100 panels', () => {
    const panelIds = Array.from({ length: 100 }, (_, panelId) => panelId);
    const window = getPanelPickerWindow(99, panelIds, 4);
    const rendered = renderPanelBoxes(99, panelIds, 4);

    expect(window.visiblePanelIds).toEqual([96, 97, 98, 99]);
    expect(rendered).toContain('P100');
    expect(rendered).toContain('100/100 in workspace');
    expect(rendered).toContain('…');
    expect(rendered.length).toBeLessThan(400);
  });

  it('reduces visible labels and summary copy for narrow dialogs', () => {
    const panelIds = Array.from({ length: 100 }, (_, panelId) => panelId);
    const rendered = renderPanelBoxes(99, panelIds, 4, 24);

    expect(panelLabelsForWidth(panelIds, 24, 4)).toBe(1);
    expect(rendered).toContain('P100');
    expect(rendered).toContain('100/100');
    expect(rendered).not.toContain('in workspace');
    expect(rendered).not.toContain('P99');
  });

  it('deduplicates malformed ID collections without reordering valid IDs', () => {
    expect(normalizePanelIds([9, 2, 9, -1, 99, Number.NaN])).toEqual([9, 2, 99]);
  });
});
