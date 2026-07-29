import { describe, expect, it } from 'vitest';
import { isValidPanelNumber } from '../../src/screen/dialog/panel-picker.js';

describe('panel picker bounds', () => {
  it.each([
    [2, [1, 2], [0, 3, 4]],
    [3, [1, 2, 3], [0, 4]],
    [4, [1, 2, 3, 4], [0, 5]],
  ])('limits choices to the active %i-panel layout', (panelCount, valid, invalid) => {
    for (const panel of valid) {
      expect(isValidPanelNumber(panel, panelCount)).toBe(true);
    }
    for (const panel of invalid) {
      expect(isValidPanelNumber(panel, panelCount)).toBe(false);
    }
  });
});
