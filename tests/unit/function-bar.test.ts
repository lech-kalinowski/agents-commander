import { beforeEach, describe, expect, it, vi } from 'vitest';

const widgets = vi.hoisted(() => ({
  box: vi.fn(),
}));

vi.mock('blessed', () => ({
  default: { box: widgets.box },
}));

import { getTheme } from '../../src/config/themes.js';
import {
  createFunctionBar,
  updateDefaultFunctionBar,
} from '../../src/screen/function-bar.js';

const theme = getTheme('classic-blue');

function textContent(bar: { setContent: ReturnType<typeof vi.fn> }): string {
  const content = bar.setContent.mock.calls.at(-1)?.[0] as string;
  return content.replace(/\{[^}]+\}/gu, '');
}

describe('Panel-first function bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ten panel controls within an 80-column terminal', () => {
    const bar = { setContent: vi.fn() };
    widgets.box.mockReturnValue(bar);

    expect(createFunctionBar({} as any, theme)).toBe(bar);

    const content = textContent(bar);
    expect(content).toHaveLength(80);
    expect(content.match(/.{8}/gu)).toEqual([
      ' 1Help  ', ' 2Agent ', ' 3+Panel', ' 4Full  ', ' 5Edit  ',
      ' 6Clone ', ' 7Order ', ' 8Mkdir ', ' 9Close ', '10Quit  ',
    ]);
  });

  it('shows Back only during fullscreen and restores Full without changing other keys', () => {
    const bar = { setContent: vi.fn() };

    updateDefaultFunctionBar(bar as any, theme);
    const gridContent = textContent(bar);

    updateDefaultFunctionBar(bar as any, theme, true);
    const fullscreenContent = textContent(bar);
    expect(fullscreenContent).toHaveLength(80);
    expect(fullscreenContent).toBe(gridContent.replace(' 4Full  ', ' 4Back  '));

    updateDefaultFunctionBar(bar as any, theme, false);
    expect(textContent(bar)).toBe(gridContent);

    const secondBar = { setContent: vi.fn() };
    updateDefaultFunctionBar(secondBar as any, theme);
    expect(textContent(secondBar)).toBe(gridContent);
  });
});
