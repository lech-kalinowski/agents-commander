import { describe, expect, it, vi } from 'vitest';

const boxMock = vi.hoisted(() => vi.fn((options: Record<string, unknown>) => ({
  ...options,
  width: 80,
  setContent: vi.fn(),
})));

vi.mock('blessed', () => ({
  default: { box: boxMock },
}));

import { createStatusBar, updateStatusBar } from '../../src/screen/status-bar.js';

describe('status bar output safety', () => {
  it('disables tag parsing and strips control characters from dynamic text', () => {
    const bar = createStatusBar({} as any, {
      statusBar: { bg: 'black', fg: 'white' },
    } as any);

    expect(boxMock).toHaveBeenCalledWith(expect.objectContaining({ tags: false }));

    updateStatusBar(bar, {
      fileName: '{red-fg}notes{/red-fg}\u001b[2J.md',
      fileDate: 'today\u0007',
    });

    const rendered = (bar.setContent as any).mock.calls.at(-1)?.[0] as string;
    expect(rendered).toContain('{red-fg}notes{/red-fg}');
    expect(rendered).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });
});
