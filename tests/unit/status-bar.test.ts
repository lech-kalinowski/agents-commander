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
  it('distinguishes workspace position from protocol ID and exposes fullscreen exit', () => {
    const bar = createStatusBar({} as any, { statusBar: { bg: 'black', fg: 'white' } } as any);
    (bar as any).width = 120;
    updateStatusBar(bar, { panelNumber: 9, workspacePosition: 1, fullscreen: true, panelCount: 4 });
    expect((bar.setContent as any).mock.calls.at(-1)[0]).toContain('FULL · F4 Back | P9 | Position #1');
  });
  it('prioritizes recording and failure indicators over panel details on narrow screens', () => {
    const bar = createStatusBar({} as any, { statusBar: { bg: 'black', fg: 'white' } } as any);
    (bar as any).width = 18;
    for (const captureLabel of ['REC:METADATA', 'REC:PROTOCOL', 'REC:INCOMPLETE'] as const) {
      updateStatusBar(bar, { captureLabel, captureEvents: 123, panelNumber: 100, panelCount: 100 });
      const rendered = (bar.setContent as any).mock.calls.at(-1)?.[0] as string;
      expect(rendered).toHaveLength(18);
      expect(rendered).toMatch(new RegExp(`^${captureLabel}`));
    }
  });

  it('disables tag parsing and strips control characters from dynamic text', () => {
    const bar = createStatusBar({} as any, {
      statusBar: { bg: 'black', fg: 'white' },
    } as any);

    expect(boxMock).toHaveBeenCalledWith(expect.objectContaining({ tags: false }));

    updateStatusBar(bar, {
      modeLabel: 'CONFERENCE\u0000',
      warning: 'Resize\u001b[2J now',
      fileName: '{red-fg}notes{/red-fg}\u001b[2J.md',
      fileDate: 'today\u0007',
    });

    const rendered = (bar.setContent as any).mock.calls.at(-1)?.[0] as string;
    expect(rendered).toContain('[CONFERENCE]');
    expect(rendered).toContain('! Resize [2J now');
    expect(rendered).toContain('{red-fg}notes{/red-fg}');
    expect(rendered).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it('renders stable panel, workspace, page, and density metadata', () => {
    const bar = createStatusBar({} as any, {
      statusBar: { bg: 'black', fg: 'white' },
    } as any);
    (bar as any).width = 120;

    updateStatusBar(bar, {
      fileName: 'notes.md',
      panelNumber: 101,
      panelCount: 100,
      pageNumber: 25,
      pageCount: 25,
      density: 'auto',
    });

    const rendered = (bar.setContent as any).mock.calls.at(-1)?.[0] as string;
    expect(rendered).toContain('notes.md');
    expect(rendered).toContain('P101 | 100 panels | Page 25/25 | Density auto');
    expect(rendered).toHaveLength(120);
  });

  it('keeps output width-bounded and panel identity first on narrow bars', () => {
    const bar = createStatusBar({} as any, {
      statusBar: { bg: 'black', fg: 'white' },
    } as any);
    (bar as any).width = 18;

    updateStatusBar(bar, {
      fileName: 'a-very-long-file-name-that-must-not-overflow.md',
      panelNumber: 100,
      panelCount: 100,
      pageNumber: 50,
      pageCount: 50,
      density: 4,
    });

    const rendered = (bar.setContent as any).mock.calls.at(-1)?.[0] as string;
    expect(rendered).toHaveLength(18);
    expect(rendered).toMatch(/^P100 \| 100 panels/u);
  });

  it('ignores invalid or unbounded numeric metadata', () => {
    const bar = createStatusBar({} as any, {
      statusBar: { bg: 'black', fg: 'white' },
    } as any);

    updateStatusBar(bar, {
      panelNumber: Number.MAX_SAFE_INTEGER,
      panelCount: 101,
      pageNumber: 3,
      pageCount: 2,
      density: 'dense' as never,
      selectedCount: Number.MAX_SAFE_INTEGER,
      fileCount: -1,
      dirCount: Number.POSITIVE_INFINITY,
    });

    const rendered = (bar.setContent as any).mock.calls.at(-1)?.[0] as string;
    expect(rendered.trim()).toBe('');
    expect(rendered).toHaveLength(80);
  });
});
