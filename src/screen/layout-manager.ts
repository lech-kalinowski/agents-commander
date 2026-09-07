import blessed from 'blessed';
import type { Theme, AppConfig } from '../config/types.js';
import type { FileEntry } from '../file-manager/types.js';
import {
  MAX_ACTIVE_PANELS,
  MAX_PANEL_ID,
  MIN_ACTIVE_PANELS,
  isActivePanelCount,
  isPanelDensity,
  type PanelDensity,
} from '../panel-limits.js';
import { FilePanel } from '../panels/file-panel.js';
import { TerminalPanel } from '../panels/terminal-panel.js';
import { logger } from '../utils/logger.js';
import {
  calculateResponsiveLayout,
  type ResponsiveLayout,
} from './responsive-layout.js';

export type LayoutMode = PanelDensity;
type Panel = FilePanel | TerminalPanel;

interface PanelPosition {
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
}

interface FilePanelLoad {
  generation: number;
  promise: Promise<void>;
}

export interface LayoutViewport {
  density: LayoutMode;
  /** Zero-based page containing the active panel. */
  pageIndex: number;
  /** One-based page for display, or zero before any panels exist. */
  pageNumber: number;
  pageCount: number;
  capacity: number;
  panelCount: number;
  /** Workspace-order start offset of this page. */
  startIndex: number;
  /** Exclusive workspace-order end offset of this page. */
  endIndex: number;
  visiblePanelIds: readonly number[];
  rows: number;
  columns: number;
  compact: boolean;
  usableWidth: number;
  usableHeight: number;
}

const CHROME_ROWS = 3;
const MIN_PANEL_WIDTH = 40;
const MIN_PANEL_HEIGHT = 10;
const INITIAL_PANEL_POSITION: PanelPosition = {
  top: 0,
  left: 0,
  width: 1,
  height: 1,
};

export class LayoutManager {
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private config: AppConfig;
  /** Ordered live workspace. Array position is never used as panel identity. */
  private panels: Panel[] = [];
  private _activePanelId: number | null = null;
  private _mode: LayoutMode = 'auto';
  private _isFullscreen = false;
  private workingDir: string = process.cwd();
  private nextPanelId = 0;
  private currentPageIndex = 0;
  private loadedFilePanelIds = new Set<number>();
  private filePanelGenerations = new Map<number, number>();
  private filePanelLoads = new Map<number, FilePanelLoad>();
  private currentViewport: LayoutViewport = {
    density: 'auto',
    pageIndex: 0,
    pageNumber: 0,
    pageCount: 0,
    capacity: 1,
    panelCount: 0,
    startIndex: 0,
    endIndex: 0,
    visiblePanelIds: [],
    rows: 0,
    columns: 0,
    compact: false,
    usableWidth: 1,
    usableHeight: 1,
  };

  get mode(): LayoutMode {
    return this._mode;
  }

  get density(): LayoutMode {
    return this._mode;
  }

  /** Fullscreen is a temporary view; it never replaces the selected density. */
  get isFullscreen(): boolean {
    return this._isFullscreen;
  }

  get activePanelId(): number | null {
    return this._activePanelId;
  }

  get activePanel(): Panel {
    const panel = this._activePanelId === null
      ? undefined
      : this.findPanel(this._activePanelId);
    if (!panel) throw new Error('LayoutManager has no active panel');
    return panel;
  }

  get activeFilePanel(): FilePanel | null {
    const panel = this._activePanelId === null
      ? undefined
      : this.findPanel(this._activePanelId);
    return panel instanceof FilePanel ? panel : null;
  }

  get activeTerminalPanel(): TerminalPanel | null {
    const panel = this._activePanelId === null
      ? undefined
      : this.findPanel(this._activePanelId);
    return panel instanceof TerminalPanel ? panel : null;
  }

  /** Return the first inactive file panel in workspace order. */
  get inactiveFilePanel(): FilePanel | null {
    for (const panel of this.panels) {
      if (panel.panelIndex !== this._activePanelId && panel instanceof FilePanel) {
        return panel;
      }
    }
    return null;
  }

  /** Detached ordered workspace snapshot. Panel objects retain their stable IDs. */
  get allPanels(): Panel[] {
    return [...this.panels];
  }

  get filePanels(): FilePanel[] {
    return this.panels.filter((panel): panel is FilePanel => panel instanceof FilePanel);
  }

  get terminalPanels(): TerminalPanel[] {
    return this.panels.filter((panel): panel is TerminalPanel => panel instanceof TerminalPanel);
  }

  get visiblePanels(): Panel[] {
    const ids = new Set(this.currentViewport.visiblePanelIds);
    return this.panels.filter((panel) => ids.has(panel.panelIndex));
  }

  get visiblePanelIds(): readonly number[] {
    return [...this.currentViewport.visiblePanelIds];
  }

  get workspacePanelIds(): readonly number[] {
    return this.panels.map((panel) => panel.panelIndex);
  }

  /** Stable IDs in workspace order. */
  get panelIds(): readonly number[] {
    return this.workspacePanelIds;
  }

  get viewport(): LayoutViewport {
    return {
      ...this.currentViewport,
      visiblePanelIds: [...this.currentViewport.visiblePanelIds],
    };
  }

  get pageIndex(): number {
    return this.currentViewport.pageIndex;
  }

  get pageCount(): number {
    return this.currentViewport.pageCount;
  }

  get pageCapacity(): number {
    return this.currentViewport.capacity;
  }

  get panelCount(): number {
    return this.panels.length;
  }

  /** Callback fired when active panel changes (e.g. for status bar updates). */
  public onPanelFocused: (() => void) | null = null;
  /** Callback fired when Enter opens a regular file from any file panel. */
  public onOpenFile: ((entry: FileEntry) => void) | null = null;

  constructor(screen: blessed.Widgets.Screen, theme: Theme, config: AppConfig) {
    this.screen = screen;
    this.theme = theme;
    this.config = config;
  }

  /** Attach click-to-focus and file callbacks using the immutable panel ID. */
  private attachPanelCallbacks(panel: Panel): void {
    const panelId = panel.panelIndex;
    panel.onMouseClick = () => {
      if (this._activePanelId !== panelId) {
        this.setActivePanel(panelId);
        this.onPanelFocused?.();
      }
    };
    if (panel instanceof FilePanel) {
      panel.onSelectionChange = () => {
        this.onPanelFocused?.();
      };
      panel.onOpenFile = (entry) => {
        this.onOpenFile?.(entry);
      };
    }
  }

  async initialize(
    initialPath: string,
    panelCount = 2,
    density: LayoutMode = this.config.panelDensity ?? 'auto',
  ): Promise<void> {
    if (this.panels.length > 0) {
      throw new Error('LayoutManager is already initialized');
    }
    if (!isActivePanelCount(panelCount)) {
      throw new RangeError(
        `Panel count must be between ${MIN_ACTIVE_PANELS} and ${MAX_ACTIVE_PANELS}`,
      );
    }
    if (!isPanelDensity(density)) {
      throw new RangeError('Panel density must be auto, 2, 3, or 4');
    }

    this._mode = density;
    this.workingDir = initialPath;
    this.currentPageIndex = 0;

    for (let index = 0; index < panelCount; index++) {
      const panelId = this.allocatePanelId();
      if (panelId === null) {
        throw new RangeError(`Panel ID limit ${MAX_PANEL_ID} reached`);
      }
      const panel = this.createFilePanel(panelId, initialPath);
      this.panels.push(panel);
    }

    this._activePanelId = this.panels[0].panelIndex;
    this.reflow(false);
    this.activePanel.setFocus(true);
    await this.loadVisibleFilePanels();
    this.screen.render();
  }

  setActivePanel(panelId: number): void {
    const panel = this.findPanel(panelId);
    if (!panel) return;

    const previous = this._activePanelId === null
      ? undefined
      : this.findPanel(this._activePanelId);
    if (previous && previous !== panel) previous.setFocus(false);

    this._activePanelId = panelId;
    this.reflow(false);
    panel.setFocus(true);
    this.scheduleVisibleFilePanelLoads();
    this.screen.render();
  }

  cyclePanel(): void {
    this.focusPanelOffset(1);
  }

  /** Focus a workspace neighbour, wrapping at either end. */
  focusPanelOffset(delta: number): boolean {
    if (this.panels.length === 0 || !Number.isSafeInteger(delta) || delta === 0) return false;
    const currentIndex = this._activePanelId === null
      ? 0
      : this.panels.findIndex((panel) => panel.panelIndex === this._activePanelId);
    const baseIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = ((baseIndex + delta) % this.panels.length + this.panels.length)
      % this.panels.length;
    this.setActivePanel(this.panels[nextIndex].panelIndex);
    return true;
  }

  /**
   * Focus the same visible slot on another page, wrapping between pages.
   * A short final page clamps the slot to its final panel.
   */
  focusPageOffset(delta: number): boolean {
    const { capacity, pageCount, pageIndex, startIndex } = this.currentViewport;
    if (
      this.panels.length === 0
      || pageCount <= 1
      || !Number.isSafeInteger(delta)
      || delta === 0
    ) return false;

    const currentIndex = this._activePanelId === null
      ? startIndex
      : this.panels.findIndex((panel) => panel.panelIndex === this._activePanelId);
    const visibleSlot = Math.max(0, currentIndex - startIndex);
    const targetPage = ((pageIndex + delta) % pageCount + pageCount) % pageCount;
    const targetStart = targetPage * capacity;
    const targetEnd = Math.min(targetStart + capacity, this.panels.length);
    const targetIndex = Math.min(targetStart + visibleSlot, targetEnd - 1);
    this.setActivePanel(this.panels[targetIndex].panelIndex);
    return true;
  }

  /** Focus a one-based slot on the currently visible page. */
  focusVisibleSlot(slot: number): boolean {
    if (!Number.isSafeInteger(slot) || slot < 1) return false;
    const panelId = this.currentViewport.visiblePanelIds[slot - 1];
    if (panelId === undefined) return false;
    this.setActivePanel(panelId);
    return true;
  }

  /** Focus a one-based panel in workspace order, bringing its page into view. */
  focusWorkspaceSlot(slot: number): boolean {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > this.panels.length) return false;
    this.setActivePanel(this.panels[slot - 1].panelIndex);
    return true;
  }

  getPanel(panelId: number): Panel | null {
    return this.findPanel(panelId) ?? null;
  }

  hasPanel(panelId: number): boolean {
    return this.findPanel(panelId) !== undefined;
  }

  /** Stable one-based panel number used by the UI and Commander protocol. */
  getPanelNumber(panelId: number): number | null {
    return this.findPanel(panelId) ? panelId + 1 : null;
  }

  /** Current one-based workspace position, independent of the stable panel number. */
  getWorkspacePosition(panelId: number): number | null {
    const index = this.panels.findIndex((panel) => panel.panelIndex === panelId);
    return index < 0 ? null : index + 1;
  }

  /** Move a panel to a one-based workspace position without changing its identity. */
  movePanel(panelId: number, position: number): boolean {
    if (!Number.isSafeInteger(position) || position < 1 || position > this.panels.length) {
      return false;
    }
    const currentIndex = this.panels.findIndex((panel) => panel.panelIndex === panelId);
    const targetIndex = position - 1;
    if (currentIndex < 0 || currentIndex === targetIndex) return false;

    const [panel] = this.panels.splice(currentIndex, 1);
    this.panels.splice(targetIndex, 0, panel);
    this.reflow(false);
    this.scheduleVisibleFilePanelLoads();
    this.screen.render();
    return true;
  }

  /** Toggle the active panel's fullscreen view, retaining density and all sessions. */
  toggleFullscreen(): boolean {
    if (this.panels.length === 0) return false;
    this._isFullscreen = !this._isFullscreen;
    this.reflow(false);
    this.scheduleVisibleFilePanelLoads();
    this.screen.render();
    return this._isFullscreen;
  }

  /** Restore the selected density around the current active panel. */
  exitFullscreen(): boolean {
    if (!this._isFullscreen) return false;
    this.toggleFullscreen();
    return true;
  }

  /**
   * Prepare one panel as a terminal while preserving its stable ID.
   *
   * Hidden panels keep their last Blessed geometry because normal reflow only
   * resizes the active page. Compute the rectangle this panel would occupy on
   * its own page so a terminal launched before that page is focused never
   * inherits the 1x1 construction placeholder. Existing terminals are resized
   * in place so their process and object identity remain intact.
   */
  convertToTerminal(panelId: number): TerminalPanel {
    const workspaceIndex = this.requirePanelWorkspaceIndex(panelId);
    const old = this.panels[workspaceIndex];
    const position = this.pagePositionForWorkspaceIndex(workspaceIndex)
      ?? this.positionOf(old);
    if (old instanceof TerminalPanel) {
      this.resizePanelIfChanged(old, position);
      return old;
    }

    const cwd = old.currentPath;
    old.destroy();
    this.loadedFilePanelIds.delete(panelId);
    this.filePanelGenerations.delete(panelId);
    this.filePanelLoads.delete(panelId);

    const terminal = new TerminalPanel(
      this.screen,
      this.theme,
      panelId,
      cwd,
      position,
      this.config,
    );
    this.panels[workspaceIndex] = terminal;
    this.attachPanelCallbacks(terminal);
    this.reflow(false);

    if (this._activePanelId === panelId) terminal.setFocus(true);
    this.screen.render();
    return terminal;
  }

  /** Convert one terminal panel back to a file panel while preserving its ID. */
  async convertToFile(panelId: number, initialPath?: string): Promise<FilePanel> {
    const workspaceIndex = this.requirePanelWorkspaceIndex(panelId);
    const old = this.panels[workspaceIndex];
    if (old instanceof FilePanel) return old;

    const position = this.positionOf(old);
    old.destroy();

    const filePanel = this.createFilePanel(
      panelId,
      initialPath ?? this.workingDir,
      position,
    );
    this.panels[workspaceIndex] = filePanel;
    this.reflow(false);

    if (this._activePanelId === panelId) filePanel.setFocus(true);
    if (this.currentViewport.visiblePanelIds.includes(panelId)) {
      await this.loadFilePanel(filePanel);
    }
    this.screen.render();
    return filePanel;
  }

  isTerminalPanel(panelId: number): boolean {
    return this.findPanel(panelId) instanceof TerminalPanel;
  }

  getTerminalPanel(panelId: number): TerminalPanel | null {
    const panel = this.findPanel(panelId);
    return panel instanceof TerminalPanel ? panel : null;
  }

  /** Add and activate a file panel without changing the current density. */
  async addPanel(initialPath?: string): Promise<boolean> {
    if (this.panels.length >= MAX_ACTIVE_PANELS) return false;

    const panelId = this.allocatePanelId();
    if (panelId === null) return false;

    const panel = this.createFilePanel(panelId, initialPath ?? this.workingDir);
    const previous = this._activePanelId === null
      ? undefined
      : this.findPanel(this._activePanelId);
    previous?.setFocus(false);
    this.panels.push(panel);
    this._activePanelId = panelId;
    this.reflow(false);
    panel.setFocus(true);
    await this.loadVisibleFilePanels();
    this.screen.render();
    return true;
  }

  /** Remove one panel by stable ID. Remaining panel IDs are never changed. */
  removePanel(panelId = this._activePanelId ?? -1): boolean {
    if (this.panels.length <= MIN_ACTIVE_PANELS) return false;

    const workspaceIndex = this.panels.findIndex((panel) => panel.panelIndex === panelId);
    if (workspaceIndex < 0) return false;

    const removed = this.panels[workspaceIndex];
    const removedWasActive = this._activePanelId === panelId;
    removed.destroy();
    this.panels.splice(workspaceIndex, 1);
    this.loadedFilePanelIds.delete(panelId);
    this.filePanelGenerations.delete(panelId);
    this.filePanelLoads.delete(panelId);

    if (removedWasActive) {
      const nextActiveIndex = Math.min(workspaceIndex, this.panels.length - 1);
      this._activePanelId = this.panels[nextActiveIndex].panelIndex;
    }

    this.reflow(false);
    if (removedWasActive) this.activePanel.setFocus(true);
    this.scheduleVisibleFilePanelLoads();
    this.screen.render();
    return true;
  }

  /** Change visible density without recreating any panel or terminal session. */
  async setMode(mode: LayoutMode): Promise<void> {
    if (!isPanelDensity(mode)) return;
    if (mode === this._mode && !this._isFullscreen) return;

    this._mode = mode;
    this._isFullscreen = false;
    this.reflow(false);
    await this.loadVisibleFilePanels();
    this.screen.render();
  }

  /** Explicitly destructive reset to two new file panels with fresh P1/P2 IDs. */
  async resetToDefault(): Promise<void> {
    for (const panel of this.panels) panel.destroy();
    this.panels = [];
    this.loadedFilePanelIds.clear();
    this.filePanelGenerations.clear();
    this.filePanelLoads.clear();
    this.nextPanelId = 0;
    this.currentPageIndex = 0;
    this._activePanelId = null;
    this._mode = 2;
    this._isFullscreen = false;

    for (let index = 0; index < 2; index++) {
      const panelId = this.allocatePanelId();
      if (panelId === null) throw new RangeError(`Panel ID limit ${MAX_PANEL_ID} reached`);
      this.panels.push(this.createFilePanel(panelId, this.workingDir));
    }

    this._activePanelId = this.panels[0].panelIndex;
    this.reflow(false);
    this.activePanel.setFocus(true);
    await this.loadVisibleFilePanels();
    this.screen.render();
  }

  /** Refresh visible file panels and mark hidden panels for lazy refresh. */
  async refreshAll(): Promise<void> {
    const visibleIds = new Set(this.currentViewport.visiblePanelIds);
    const loads: Promise<void>[] = [];

    for (const panel of this.panels) {
      if (!(panel instanceof FilePanel)) continue;
      this.invalidateFilePanel(panel.panelIndex);
      if (visibleIds.has(panel.panelIndex)) {
        loads.push(this.loadFilePanel(panel));
      }
    }

    await Promise.all(loads);
  }

  handleResize(): void {
    this.reflow(false);
    this.scheduleVisibleFilePanelLoads();
    this.screen.render();
  }

  private findPanel(panelId: number): Panel | undefined {
    return this.panels.find((panel) => panel.panelIndex === panelId);
  }

  private requirePanelWorkspaceIndex(panelId: number): number {
    const index = this.panels.findIndex((panel) => panel.panelIndex === panelId);
    if (index < 0) throw new RangeError(`Unknown panel ID: ${panelId}`);
    return index;
  }

  private allocatePanelId(): number | null {
    if (this.nextPanelId > MAX_PANEL_ID) return null;
    const panelId = this.nextPanelId;
    this.nextPanelId++;
    return panelId;
  }

  private createFilePanel(
    panelId: number,
    initialPath: string,
    position: PanelPosition = INITIAL_PANEL_POSITION,
  ): FilePanel {
    const panel = new FilePanel(
      this.screen,
      this.theme,
      panelId,
      initialPath,
      position,
      this.filePanelOptions(),
    );
    this.attachPanelCallbacks(panel);
    return panel;
  }

  private positionOf(panel: Panel): PanelPosition {
    return {
      top: panel.box.top,
      left: panel.box.left,
      width: panel.box.width,
      height: panel.box.height,
    };
  }

  /** Return a panel's rectangle on its own page without changing the active page. */
  private pagePositionForWorkspaceIndex(workspaceIndex: number): PanelPosition | null {
    if (workspaceIndex < 0 || workspaceIndex >= this.panels.length) return null;

    const capacity = this.responsiveLayout(this.panels.length).capacity;
    const pageStartIndex = Math.floor(workspaceIndex / capacity) * capacity;
    const pagePanelCount = Math.min(capacity, this.panels.length - pageStartIndex);
    const pageLayout = this.responsiveLayout(pagePanelCount);
    const rectangle = pageLayout.rectangles[workspaceIndex - pageStartIndex];
    if (!rectangle) return null;
    return {
      top: rectangle.top,
      left: rectangle.left,
      width: rectangle.width,
      height: rectangle.height,
    };
  }

  private filePanelOptions(): Pick<AppConfig, 'showHidden' | 'sortBy' | 'sortAscending'> {
    return {
      showHidden: this.config.showHidden,
      sortBy: this.config.sortBy,
      sortAscending: this.config.sortAscending,
    };
  }

  private responsiveLayout(panelCount: number): ResponsiveLayout {
    return calculateResponsiveLayout({
      screenWidth: typeof this.screen.width === 'number' ? this.screen.width : 80,
      screenHeight: typeof this.screen.height === 'number' ? this.screen.height : 24,
      chromeRows: CHROME_ROWS,
      panelCount,
      density: this._mode,
      minOuterWidth: MIN_PANEL_WIDTH,
      minOuterHeight: MIN_PANEL_HEIGHT,
      maxVisible: this._isFullscreen ? 1 : MAX_ACTIVE_PANELS,
    });
  }

  /** Recalculate one visible page without recreating or renumbering panels. */
  private reflow(render = true): void {
    const capacityLayout = this.responsiveLayout(this.panels.length);
    const capacity = capacityLayout.capacity;
    const pageCount = this.panels.length === 0
      ? 0
      : Math.ceil(this.panels.length / capacity);

    if (this._activePanelId !== null) {
      const activeWorkspaceIndex = this.panels.findIndex(
        (panel) => panel.panelIndex === this._activePanelId,
      );
      if (activeWorkspaceIndex >= 0) {
        this.currentPageIndex = Math.floor(activeWorkspaceIndex / capacity);
      }
    }
    this.currentPageIndex = pageCount === 0
      ? 0
      : Math.max(0, Math.min(this.currentPageIndex, pageCount - 1));

    const startIndex = this.currentPageIndex * capacity;
    const pagePanels = this.panels.slice(startIndex, startIndex + capacity);
    const pageLayout = this.responsiveLayout(pagePanels.length);
    const visiblePanelIds = pagePanels.map((panel) => panel.panelIndex);
    const visibleIds = new Set(visiblePanelIds);

    // Hide first so showing panels never overlaps an old page.
    for (const panel of this.panels) {
      if (!visibleIds.has(panel.panelIndex)) panel.setVisible(false);
    }

    for (let index = 0; index < pagePanels.length; index++) {
      const panel = pagePanels[index];
      const rectangle = pageLayout.rectangles[index];
      if (rectangle) this.resizePanelIfChanged(panel, rectangle);
      panel.setVisible(true);
    }

    this.currentViewport = {
      density: this._mode,
      pageIndex: this.currentPageIndex,
      pageNumber: pageCount === 0 ? 0 : this.currentPageIndex + 1,
      pageCount,
      capacity,
      panelCount: this.panels.length,
      startIndex,
      endIndex: startIndex + pagePanels.length,
      visiblePanelIds,
      rows: pageLayout.rows,
      columns: pageLayout.columns,
      compact: pageLayout.compact,
      usableWidth: pageLayout.usableWidth,
      usableHeight: pageLayout.usableHeight,
    };

    if (render) this.screen.render();
  }

  private resizePanelIfChanged(panel: Panel, position: PanelPosition): void {
    if (
      panel.box.top === position.top
      && panel.box.left === position.left
      && panel.box.width === position.width
      && panel.box.height === position.height
    ) return;
    panel.resize(position);
  }

  private invalidateFilePanel(panelId: number): void {
    this.loadedFilePanelIds.delete(panelId);
    this.filePanelGenerations.set(
      panelId,
      (this.filePanelGenerations.get(panelId) ?? 0) + 1,
    );
  }

  private async loadFilePanel(panel: FilePanel): Promise<void> {
    const panelId = panel.panelIndex;
    if (this.loadedFilePanelIds.has(panelId)) return;
    const generation = this.filePanelGenerations.get(panelId) ?? 0;

    const existing = this.filePanelLoads.get(panelId);
    if (existing) {
      await existing.promise;
      if (
        existing.generation !== (this.filePanelGenerations.get(panelId) ?? 0)
        && this.findPanel(panelId) === panel
        && this.currentViewport.visiblePanelIds.includes(panelId)
      ) {
        await this.loadFilePanel(panel);
      }
      return;
    }

    let pending!: Promise<void>;
    pending = panel.loadDirectory()
      .then((loaded) => {
        if (
          loaded !== false
          && this.findPanel(panelId) === panel
          && (this.filePanelGenerations.get(panelId) ?? 0) === generation
        ) {
          this.loadedFilePanelIds.add(panelId);
        }
      })
      .finally(() => {
        if (this.filePanelLoads.get(panelId)?.promise === pending) {
          this.filePanelLoads.delete(panelId);
        }
      });
    this.filePanelLoads.set(panelId, { generation, promise: pending });
    await pending;
    if (
      generation !== (this.filePanelGenerations.get(panelId) ?? 0)
      && this.findPanel(panelId) === panel
      && this.currentViewport.visiblePanelIds.includes(panelId)
    ) {
      await this.loadFilePanel(panel);
    }
  }

  private async loadVisibleFilePanels(): Promise<void> {
    const visibleIds = new Set(this.currentViewport.visiblePanelIds);
    await Promise.all(
      this.panels
        .filter((panel): panel is FilePanel => (
          panel instanceof FilePanel && visibleIds.has(panel.panelIndex)
        ))
        .map((panel) => this.loadFilePanel(panel)),
    );
  }

  private scheduleVisibleFilePanelLoads(): void {
    void this.loadVisibleFilePanels().catch((error) => {
      logger.error('Failed to lazily load visible file panels', error);
    });
  }
}
