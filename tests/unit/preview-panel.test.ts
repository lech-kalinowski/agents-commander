import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const blessedMocks = vi.hoisted(() => {
  const boxes: any[] = [];
  const box = vi.fn((options: Record<string, unknown>) => {
    const element = {
      ...options,
      key: vi.fn(),
      setContent: vi.fn(),
      setLabel: vi.fn(),
      scrollTo: vi.fn(),
      focus: vi.fn(),
      show: vi.fn(),
      destroy: vi.fn(),
    };
    boxes.push(element);
    return element;
  });
  return { box, boxes };
});

vi.mock('blessed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('blessed')>();
  return {
    default: {
      ...actual.default,
      box: blessedMocks.box,
    },
  };
});
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { PreviewPanel } from '../../src/panels/preview-panel.js';
import { isDialogActive } from '../../src/utils/dialog-state.js';

const theme = {
  panel: {
    bg: 'black',
    fg: 'white',
    border: { fg: 'blue' },
  },
} as any;

let tempDir: string | null = null;
let openPanel: PreviewPanel | null = null;

afterEach(async () => {
  openPanel?.close();
  openPanel = null;
  blessedMocks.box.mockClear();
  blessedMocks.boxes.length = 0;
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('PreviewPanel overlay safety', () => {
  it('holds dialog state for its lifetime and closes idempotently', () => {
    const screen = { render: vi.fn() } as any;
    const onClose = vi.fn();
    openPanel = new PreviewPanel(
      screen,
      theme,
      { top: 0, left: 0, width: 80, height: 24 },
      onClose,
    );

    expect(isDialogActive()).toBe(true);

    openPanel.close();
    openPanel.close();
    openPanel = null;

    expect(isDialogActive()).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(blessedMocks.boxes[0].destroy).toHaveBeenCalledOnce();
  });

  it('neutralizes filename tags and control bytes in preview content', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-preview-'));
    const filePath = path.join(tempDir, '{red-fg}demo{red-fg}\u001b.md');
    await fs.writeFile(filePath, '{bold}safe{/bold}\u001b[2J\nnext');
    const screen = { render: vi.fn() } as any;
    openPanel = new PreviewPanel(
      screen,
      theme,
      { top: 0, left: 0, width: 80, height: 24 },
    );

    await openPanel.loadFile(filePath);

    const frame = blessedMocks.boxes[0];
    const content = blessedMocks.boxes[1];
    expect(frame.setLabel).toHaveBeenCalledWith(
      expect.stringContaining('{open}red-fg{close}demo{open}red-fg{close}'),
    );
    const rendered = content.setContent.mock.calls.at(-1)?.[0] as string;
    expect(rendered).toContain('{open}bold{close}safe{open}/bold{close}');
    expect(rendered).not.toContain('\\{bold\\}');
    expect(rendered).not.toContain('\u001b');
  });
});
