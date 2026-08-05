import { beforeEach, describe, expect, it, vi } from 'vitest';

const panelMocks = vi.hoisted(() => ({
  filePanels: [] as any[],
  terminalPanels: [] as any[],
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('../../src/panels/file-panel.js', () => {
  class MockFilePanel {
    public box: { top: number | string; left: number | string; width: number | string; height: number | string };
    public panelIndex: number;
    public currentPath: string;
    public onMouseClick: (() => void) | null = null;
    public onSelectionChange: (() => void) | null = null;
    public onOpenFile: ((entry: unknown) => void) | null = null;
    public visible = true;
    public focused = false;
    public destroyed = false;
    public readonly loadDirectory = vi.fn(async () => true);
    public readonly setFocus = vi.fn((focused: boolean) => {
      this.focused = focused;
    });
    public readonly setVisible = vi.fn((visible: boolean) => {
      this.visible = visible;
    });
    public readonly resize = vi.fn((position: typeof this.box) => {
      Object.assign(this.box, position);
    });
    public readonly destroy = vi.fn(() => {
      this.destroyed = true;
      this.visible = false;
    });

    constructor(
      _screen: unknown,
      _theme: unknown,
      panelIndex: number,
      initialPath: string,
      position: typeof this.box,
    ) {
      this.panelIndex = panelIndex;
      this.currentPath = initialPath;
      this.box = { ...position };
      panelMocks.filePanels.push(this);
    }
  }

  return { FilePanel: MockFilePanel };
});

vi.mock('../../src/panels/terminal-panel.js', () => {
  class MockTerminalPanel {
    public box: { top: number | string; left: number | string; width: number | string; height: number | string };
    public panelIndex: number;
    public workingDir: string;
    public onMouseClick: (() => void) | null = null;
    public visible = true;
    public focused = false;
    public destroyed = false;
    public isRunning = true;
    public launchPosition: typeof this.box | null = null;
    public readonly setFocus = vi.fn((focused: boolean) => {
      this.focused = focused;
    });
    public readonly setVisible = vi.fn((visible: boolean) => {
      this.visible = visible;
    });
    public readonly resize = vi.fn((position: typeof this.box) => {
      Object.assign(this.box, position);
    });
    public readonly destroy = vi.fn(() => {
      this.destroyed = true;
      this.visible = false;
    });
    public readonly launchAgent = vi.fn(() => {
      this.launchPosition = { ...this.box };
      return true;
    });

    constructor(
      _screen: unknown,
      _theme: unknown,
      panelIndex: number,
      workingDir: string,
      position: typeof this.box,
    ) {
      this.panelIndex = panelIndex;
      this.workingDir = workingDir;
      this.box = { ...position };
      panelMocks.terminalPanels.push(this);
    }
  }

  return { TerminalPanel: MockTerminalPanel };
});

import { LayoutManager } from '../../src/screen/layout-manager.js';
import { MAX_PANEL_ID } from '../../src/panel-limits.js';

function createScreen(width = 80, height = 24) {
  return {
    width,
    height,
    render: vi.fn(),
  } as any;
}

function createLayout(width = 80, height = 24) {
  const screen = createScreen(width, height);
  const config = {
    panelDensity: 'auto',
    showHidden: false,
    sortBy: 'name',
    sortAscending: true,
  } as any;
  return {
    layout: new LayoutManager(screen, {} as any, config),
    screen,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('LayoutManager responsive workspace', () => {
  beforeEach(() => {
    panelMocks.filePanels.length = 0;
    panelMocks.terminalPanels.length = 0;
    vi.clearAllMocks();
  });

  it('keeps panel IDs and unaffected objects stable across removal and creation', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 3, 2);
    const [panel0, panel1, panel2] = layout.allPanels as any[];

    layout.setActivePanel(2);
    expect(layout.removePanel(1)).toBe(true);

    expect(layout.workspacePanelIds).toEqual([0, 2]);
    expect(layout.panelIds).toEqual([0, 2]);
    expect(layout.hasPanel(1)).toBe(false);
    expect(layout.hasPanel(2)).toBe(true);
    expect(layout.activePanelId).toBe(2);
    expect(layout.getPanel(0)).toBe(panel0);
    expect(layout.getPanel(2)).toBe(panel2);
    expect(panel0.destroy).not.toHaveBeenCalled();
    expect(panel1.destroy).toHaveBeenCalledOnce();
    expect(panel2.destroy).not.toHaveBeenCalled();

    await expect(layout.addPanel()).resolves.toBe(true);
    expect(layout.workspacePanelIds).toEqual([0, 2, 3]);
    expect(layout.activePanelId).toBe(3);
    expect(layout.visiblePanelIds).toContain(3);
    expect(layout.getPanelNumber(2)).toBe(3);
  });

  it('changes density and screen geometry without recreating panels or terminals', async () => {
    const { layout, screen } = createLayout(80, 24);
    await layout.initialize('/repo', 4, 2);
    const terminal = layout.convertToTerminal(1) as any;
    const workspace = layout.allPanels;

    await layout.setMode(4);
    screen.width = 160;
    screen.height = 40;
    layout.handleResize();

    expect(layout.mode).toBe(4);
    expect(layout.allPanels).toEqual(workspace);
    expect(layout.workspacePanelIds).toEqual([0, 1, 2, 3]);
    expect(layout.getTerminalPanel(1)).toBe(terminal);
    expect(terminal.destroy).not.toHaveBeenCalled();
    expect(terminal.resize).toHaveBeenCalled();
    for (const panel of layout.allPanels as any[]) {
      expect(panel.destroy).not.toHaveBeenCalled();
    }
  });

  it('pages by workspace order, makes selected IDs visible, and cycles across pages', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 5, 2);

    expect(layout.viewport).toMatchObject({
      pageIndex: 0,
      pageNumber: 1,
      pageCount: 3,
      capacity: 2,
      panelCount: 5,
      startIndex: 0,
      endIndex: 2,
      visiblePanelIds: [0, 1],
    });

    layout.setActivePanel(4);
    expect(layout.activePanelId).toBe(4);
    expect(layout.pageIndex).toBe(2);
    expect(layout.visiblePanelIds).toEqual([4]);
    expect((layout.getPanel(4) as any).visible).toBe(true);
    expect((layout.getPanel(0) as any).visible).toBe(false);

    layout.setActivePanel(1);
    layout.cyclePanel();
    expect(layout.activePanelId).toBe(2);
    expect(layout.pageIndex).toBe(1);
    expect(layout.visiblePanelIds).toEqual([2, 3]);

    layout.setActivePanel(4);
    layout.cyclePanel();
    expect(layout.activePanelId).toBe(0);
    expect(layout.pageIndex).toBe(0);
  });

  it('expands the visible auto-density page on resize without touching workspace identity', async () => {
    const { layout, screen } = createLayout(80, 24);
    await layout.initialize('/repo', 8, 'auto');
    const workspace = layout.allPanels;

    expect(layout.pageCapacity).toBe(4);
    expect(layout.visiblePanelIds).toEqual([0, 1, 2, 3]);

    screen.width = 160;
    layout.handleResize();

    expect(layout.pageCapacity).toBe(8);
    expect(layout.visiblePanelIds).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(layout.allPanels).toEqual(workspace);
    for (const panel of layout.allPanels as any[]) {
      expect(panel.destroy).not.toHaveBeenCalled();
    }
  });

  it('supports 100 live panels, lazily loads visible files, and enforces the cap', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 100, 2);

    expect(layout.panelCount).toBe(100);
    expect(layout.workspacePanelIds[0]).toBe(0);
    expect(layout.workspacePanelIds[99]).toBe(99);
    expect(panelMocks.filePanels).toHaveLength(100);
    expect(panelMocks.filePanels.filter((panel) => panel.loadDirectory.mock.calls.length > 0))
      .toHaveLength(2);
    await expect(layout.addPanel()).resolves.toBe(false);

    await layout.refreshAll();
    expect(panelMocks.filePanels[0].loadDirectory).toHaveBeenCalledTimes(2);
    expect(panelMocks.filePanels[1].loadDirectory).toHaveBeenCalledTimes(2);
    expect(panelMocks.filePanels[2].loadDirectory).not.toHaveBeenCalled();

    layout.setActivePanel(99);
    expect(layout.visiblePanelIds).toEqual([98, 99]);
    expect(panelMocks.filePanels[99].loadDirectory).toHaveBeenCalledOnce();

    expect(layout.removePanel(50)).toBe(true);
    await expect(layout.addPanel()).resolves.toBe(true);
    expect(layout.workspacePanelIds).not.toContain(50);
    expect(layout.workspacePanelIds.at(-1)).toBe(100);
    expect(layout.panelCount).toBe(100);
  });

  it('reloads a hidden panel after an in-flight refresh is invalidated', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 3, 2);
    const panel0 = panelMocks.filePanels[0];
    const staleLoad = deferred<boolean>();
    panel0.loadDirectory.mockImplementationOnce(() => staleLoad.promise);

    const firstRefresh = layout.refreshAll();
    expect(panel0.loadDirectory).toHaveBeenCalledTimes(2);

    layout.setActivePanel(2);
    await layout.refreshAll();
    expect(layout.visiblePanelIds).toEqual([2]);
    expect(panel0.loadDirectory).toHaveBeenCalledTimes(2);

    staleLoad.resolve(true);
    await firstRefresh;
    expect(panel0.loadDirectory).toHaveBeenCalledTimes(2);

    layout.setActivePanel(0);
    await vi.waitFor(() => {
      expect(panel0.loadDirectory).toHaveBeenCalledTimes(3);
    });
  });

  it('prepares hidden P100 with readable launch geometry without changing the active page', async () => {
    const { layout } = createLayout(80, 24);
    await layout.initialize('/repo', 100, 2);
    const activePanel = layout.activePanel;
    const originalViewport = layout.viewport;
    const originalVisiblePanels = layout.visiblePanels;

    const terminal = layout.convertToTerminal(99) as any;
    expect(terminal.box).toEqual({ top: 11, left: 0, width: 80, height: 10 });
    expect(terminal.visible).toBe(false);
    expect(layout.activePanel).toBe(activePanel);
    expect(layout.activePanelId).toBe(0);
    expect(layout.viewport).toEqual(originalViewport);
    expect(layout.visiblePanels).toEqual(originalVisiblePanels);
    expect(layout.visiblePanelIds).toEqual([0, 1]);
    expect(layout.workspacePanelIds).toEqual(Array.from({ length: 100 }, (_, index) => index));

    expect(terminal.launchAgent()).toBe(true);
    expect(terminal.launchPosition).toEqual({ top: 11, left: 0, width: 80, height: 10 });

    terminal.resize({ top: 0, left: 0, width: 1, height: 1 });
    const preparedAgain = layout.convertToTerminal(99) as any;
    expect(preparedAgain).toBe(terminal);
    expect(preparedAgain.box.width).toBeGreaterThanOrEqual(40);
    expect(preparedAgain.box.height).toBeGreaterThanOrEqual(10);
    expect(layout.activePanel).toBe(activePanel);
    expect(layout.viewport).toEqual(originalViewport);

    layout.setActivePanel(99);
    expect(layout.getTerminalPanel(99)).toBe(terminal);
    expect(layout.visiblePanelIds).toEqual([98, 99]);
  });

  it('never reuses IDs and stops allocating after the shared ID ceiling', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 2, 2);
    (layout as any).nextPanelId = MAX_PANEL_ID;

    await expect(layout.addPanel()).resolves.toBe(true);
    expect(layout.panelIds.at(-1)).toBe(MAX_PANEL_ID);
    expect(layout.removePanel(MAX_PANEL_ID)).toBe(true);
    await expect(layout.addPanel()).resolves.toBe(false);
    expect(layout.panelIds).toEqual([0, 1]);
  });
});
