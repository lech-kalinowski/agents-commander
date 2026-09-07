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
      const { top, left, width, height } = position;
      Object.assign(this.box, { top, left, width, height });
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
      const { top, left, width, height } = position;
      Object.assign(this.box, { top, left, width, height });
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

  it('supports physical navigation by panel, page, and visible slot', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 5, 2);

    expect(layout.focusPanelOffset(-1)).toBe(true);
    expect(layout.activePanelId).toBe(4);
    expect(layout.visiblePanelIds).toEqual([4]);

    expect(layout.focusPageOffset(1)).toBe(true);
    expect(layout.activePanelId).toBe(0);
    expect(layout.visiblePanelIds).toEqual([0, 1]);

    expect(layout.focusVisibleSlot(2)).toBe(true);
    expect(layout.activePanelId).toBe(1);
    expect(layout.focusPageOffset(1)).toBe(true);
    expect(layout.activePanelId).toBe(3);
    expect(layout.visiblePanelIds).toEqual([2, 3]);

    expect(layout.focusPageOffset(1)).toBe(true);
    expect(layout.activePanelId).toBe(4);
    expect(layout.visiblePanelIds).toEqual([4]);
    expect(layout.focusVisibleSlot(2)).toBe(false);
    expect(layout.activePanelId).toBe(4);
    expect(layout.focusPanelOffset(1)).toBe(true);
    expect(layout.activePanelId).toBe(0);
  });

  it('toggles the active panel fullscreen and restores its previous grid and page', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 5, 2);
    const terminal = layout.convertToTerminal(3) as any;
    layout.setActivePanel(3);
    const originalViewport = layout.viewport;
    const originalPosition = { ...terminal.box };
    const workspace = layout.allPanels;

    expect(layout.isFullscreen).toBe(false);
    expect(layout.toggleFullscreen()).toBe(true);
    expect(layout.isFullscreen).toBe(true);
    expect(layout.mode).toBe(2);
    expect(layout.viewport).toMatchObject({
      density: 2,
      capacity: 1,
      pageIndex: 3,
      pageCount: 5,
      visiblePanelIds: [3],
      rows: 1,
      columns: 1,
    });
    expect(terminal.box).toEqual({ top: 0, left: 0, width: 80, height: 21 });
    expect(terminal.focused).toBe(true);
    expect((layout.getPanel(2) as any).visible).toBe(false);
    expect(layout.allPanels).toEqual(workspace);

    expect(layout.toggleFullscreen()).toBe(false);
    expect(layout.isFullscreen).toBe(false);
    expect(layout.viewport).toEqual(originalViewport);
    expect(terminal.box).toEqual(originalPosition);
    expect(layout.activePanelId).toBe(3);
    expect(terminal.focused).toBe(true);
    for (const panel of workspace as any[]) {
      expect(panel.destroy).not.toHaveBeenCalled();
    }
  });

  it('follows panel and page navigation fullscreen and restores responsive density after resize', async () => {
    const { layout, screen } = createLayout();
    await layout.initialize('/repo', 8, 'auto');
    layout.setActivePanel(3);
    const workspace = layout.allPanels;
    layout.toggleFullscreen();

    screen.width = 160;
    layout.handleResize();
    expect(layout.isFullscreen).toBe(true);
    expect(layout.visiblePanelIds).toEqual([3]);
    expect(layout.activePanel.box).toEqual({ top: 0, left: 0, width: 160, height: 21 });
    expect(layout.focusPanelOffset(2)).toBe(true);
    expect(layout.activePanelId).toBe(5);
    expect(layout.visiblePanelIds).toEqual([5]);
    expect(layout.focusPageOffset(1)).toBe(true);
    expect(layout.activePanelId).toBe(6);
    expect(layout.visiblePanelIds).toEqual([6]);
    expect(layout.focusVisibleSlot(2)).toBe(false);
    expect(layout.focusVisibleSlot(1)).toBe(true);
    expect(layout.activePanel.box).toEqual({ top: 0, left: 0, width: 160, height: 21 });

    expect(layout.exitFullscreen()).toBe(true);
    expect(layout.isFullscreen).toBe(false);
    expect(layout.mode).toBe('auto');
    expect(layout.pageCapacity).toBe(8);
    expect(layout.visiblePanelIds).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(layout.activePanelId).toBe(6);
    expect(layout.allPanels).toEqual(workspace);
    expect(layout.exitFullscreen()).toBe(false);
  });

  it('keeps fullscreen geometry and identity when converting active and hidden panels', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 5, 2);
    layout.toggleFullscreen();

    const activeTerminal = layout.convertToTerminal(0) as any;
    expect(activeTerminal.box).toEqual({ top: 0, left: 0, width: 80, height: 21 });
    expect(activeTerminal.visible).toBe(true);
    expect(activeTerminal.focused).toBe(true);
    const hiddenTerminal = layout.convertToTerminal(4) as any;
    expect(hiddenTerminal.box).toEqual({ top: 0, left: 0, width: 80, height: 21 });
    expect(hiddenTerminal.visible).toBe(false);
    expect(layout.activePanelId).toBe(0);
    expect(layout.visiblePanelIds).toEqual([0]);

    const activeFile = await layout.convertToFile(0, '/restored') as any;
    expect(activeFile.currentPath).toBe('/restored');
    expect(activeFile.panelIndex).toBe(0);
    expect(activeFile.box).toEqual({ top: 0, left: 0, width: 80, height: 21 });
    expect(activeFile.focused).toBe(true);
    expect(activeFile.loadDirectory).toHaveBeenCalledOnce();
    expect(layout.isFullscreen).toBe(true);
    expect(layout.workspacePanelIds).toEqual([0, 1, 2, 3, 4]);

    layout.exitFullscreen();
    expect(layout.visiblePanelIds).toEqual([0, 1]);
    expect(hiddenTerminal.destroy).not.toHaveBeenCalled();
    expect(hiddenTerminal.isRunning).toBe(true);
  });

  it('keeps fullscreen usable across add and remove, and clears it on an explicit reset', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 2, 2);
    layout.toggleFullscreen();

    await expect(layout.addPanel('/duplicate')).resolves.toBe(true);
    expect(layout.isFullscreen).toBe(true);
    expect(layout.activePanelId).toBe(2);
    expect(layout.visiblePanelIds).toEqual([2]);
    expect(layout.activePanel.box).toEqual({ top: 0, left: 0, width: 80, height: 21 });
    expect(layout.removePanel(2)).toBe(true);
    expect(layout.isFullscreen).toBe(true);
    expect(layout.activePanelId).toBe(1);
    expect(layout.visiblePanelIds).toEqual([1]);
    expect(layout.activePanel.box).toEqual({ top: 0, left: 0, width: 80, height: 21 });
    expect(layout.removePanel(0)).toBe(true);
    expect(layout.removePanel(1)).toBe(false);
    expect(layout.isFullscreen).toBe(true);
    expect(layout.visiblePanelIds).toEqual([1]);

    await layout.resetToDefault();
    expect(layout.isFullscreen).toBe(false);
    expect(layout.mode).toBe(2);
    expect(layout.workspacePanelIds).toEqual([0, 1]);
    expect(layout.visiblePanelIds).toEqual([0, 1]);
    expect(layout.activePanelId).toBe(0);
  });

  it('exits fullscreen when a density is selected, including the current density', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 5, 2);
    layout.setActivePanel(3);
    layout.toggleFullscreen();

    await layout.setMode(2);
    expect(layout.isFullscreen).toBe(false);
    expect(layout.mode).toBe(2);
    expect(layout.visiblePanelIds).toEqual([2, 3]);
    expect(layout.activePanelId).toBe(3);

    layout.toggleFullscreen();
    await layout.setMode(4);
    expect(layout.isFullscreen).toBe(false);
    expect(layout.mode).toBe(4);
    expect(layout.visiblePanelIds).toEqual([0, 1, 2, 3]);
    expect(layout.activePanelId).toBe(3);
  });

  it('does not enter fullscreen before initialization or exit it for an invalid density', async () => {
    const { layout } = createLayout();
    expect(layout.toggleFullscreen()).toBe(false);
    expect(layout.exitFullscreen()).toBe(false);
    expect(layout.isFullscreen).toBe(false);

    await layout.initialize('/repo', 2, 2);
    layout.toggleFullscreen();
    await layout.setMode(1 as any);
    expect(layout.isFullscreen).toBe(true);
    expect(layout.mode).toBe(2);
    expect(layout.visiblePanelIds).toEqual([0]);
  });

  it('moves panels in workspace order without renumbering, recreating or losing active focus', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 5, 2);
    const terminal = layout.convertToTerminal(3) as any;
    layout.setActivePanel(3);
    const workspace = layout.allPanels as any[];
    const focusCalls = terminal.setFocus.mock.calls.length;

    expect(layout.getWorkspacePosition(3)).toBe(4);
    expect(layout.movePanel(3, 1)).toBe(true);
    expect(layout.workspacePanelIds).toEqual([3, 0, 1, 2, 4]);
    expect(layout.getWorkspacePosition(3)).toBe(1);
    expect(layout.getPanelNumber(3)).toBe(4);
    expect(layout.visiblePanelIds).toEqual([3, 0]);
    expect(layout.activePanelId).toBe(3);
    expect(layout.activePanel).toBe(terminal);
    expect(terminal.focused).toBe(true);
    expect(terminal.setFocus).toHaveBeenCalledTimes(focusCalls);

    expect(layout.movePanel(3, 5)).toBe(true);
    expect(layout.workspacePanelIds).toEqual([0, 1, 2, 4, 3]);
    expect(layout.getWorkspacePosition(3)).toBe(5);
    expect(layout.visiblePanelIds).toEqual([3]);
    expect(layout.pageIndex).toBe(2);
    expect(layout.activePanelId).toBe(3);
    expect(terminal.isRunning).toBe(true);
    for (const panel of workspace) {
      expect(layout.getPanel(panel.panelIndex)).toBe(panel);
      expect(panel.destroy).not.toHaveBeenCalled();
    }
  });

  it('preserves the active fullscreen session when another panel is moved across pages', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 5, 2);
    const terminal = layout.convertToTerminal(3) as any;
    layout.setActivePanel(3);
    layout.toggleFullscreen();

    expect(layout.movePanel(0, 5)).toBe(true);
    expect(layout.workspacePanelIds).toEqual([1, 2, 3, 4, 0]);
    expect(layout.activePanelId).toBe(3);
    expect(layout.visiblePanelIds).toEqual([3]);
    expect(layout.pageIndex).toBe(2);
    expect(layout.isFullscreen).toBe(true);
    expect(terminal.box).toEqual({ top: 0, left: 0, width: 80, height: 21 });
    expect(terminal.destroy).not.toHaveBeenCalled();

    layout.exitFullscreen();
    expect(layout.visiblePanelIds).toEqual([3, 4]);
    expect(layout.pageIndex).toBe(1);
    expect(layout.activePanelId).toBe(3);
  });

  it('rejects invalid and unchanged workspace moves without side effects', async () => {
    const { layout, screen } = createLayout();
    await layout.initialize('/repo', 3, 2);
    const workspace = layout.allPanels;
    const viewport = layout.viewport;
    screen.render.mockClear();

    for (const position of [0, -1, 4, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(layout.movePanel(0, position)).toBe(false);
    }
    expect(layout.movePanel(0, 1)).toBe(false);
    expect(layout.movePanel(99, 2)).toBe(false);
    expect(layout.getWorkspacePosition(99)).toBeNull();
    expect(layout.getWorkspacePosition(Number.NaN)).toBeNull();
    expect(layout.allPanels).toEqual(workspace);
    expect(layout.viewport).toEqual(viewport);
    expect(screen.render).not.toHaveBeenCalled();
  });

  it('duplicates a file path with a fresh panel ID and keeps the default path for regular additions', async () => {
    const { layout } = createLayout();
    await layout.initialize('/repo', 2, 2);
    const source = layout.activeFilePanel as any;
    source.currentPath = '/repo/subdirectory';

    await expect(layout.addPanel(source.currentPath)).resolves.toBe(true);
    const duplicate = layout.activeFilePanel as any;
    expect(duplicate).not.toBe(source);
    expect(duplicate.panelIndex).toBe(2);
    expect(duplicate.currentPath).toBe('/repo/subdirectory');
    expect(duplicate.loadDirectory).toHaveBeenCalledOnce();
    expect(source.destroy).not.toHaveBeenCalled();
    expect(source.currentPath).toBe('/repo/subdirectory');

    await expect(layout.addPanel()).resolves.toBe(true);
    expect(layout.activeFilePanel?.currentPath).toBe('/repo');
    expect(layout.workspacePanelIds).toEqual([0, 1, 2, 3]);
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
