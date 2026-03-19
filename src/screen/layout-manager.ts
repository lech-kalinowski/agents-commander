import blessed from 'blessed';
import type { Theme, AppConfig } from '../config/types.js';
import { FilePanel } from '../panels/file-panel.js';
import { TerminalPanel } from '../panels/terminal-panel.js';

export type LayoutMode = 2 | 3 | 4;
type Panel = FilePanel | TerminalPanel;

interface PanelPosition {
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
}

export class LayoutManager {
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private config: AppConfig;
  private panels: Panel[] = [];
  private activePanelIndex = 0;
  private _mode: LayoutMode = 2;
  private workingDir: string = process.cwd();

  get mode(): LayoutMode {
    return this._mode;
  }

  get activePanel(): Panel {
    return this.panels[this.activePanelIndex];
  }

  get activeFilePanel(): FilePanel | null {
    const p = this.panels[this.activePanelIndex];
    return p instanceof FilePanel ? p : null;
  }

  get activeTerminalPanel(): TerminalPanel | null {
    const p = this.panels[this.activePanelIndex];
    return p instanceof TerminalPanel ? p : null;
  }

  /** Return the first inactive file panel (for copy/move targets). */
  get inactiveFilePanel(): FilePanel | null {
    for (let i = 0; i < this.panels.length; i++) {
      if (i !== this.activePanelIndex && this.panels[i] instanceof FilePanel) {
        return this.panels[i] as FilePanel;
      }
    }
    return null;
  }

  get allPanels(): Panel[] {
    return this.panels;
  }

  get filePanels(): FilePanel[] {
    return this.panels.filter((p): p is FilePanel => p instanceof FilePanel);
  }

  get terminalPanels(): TerminalPanel[] {
    return this.panels.filter((p): p is TerminalPanel => p instanceof TerminalPanel);
  }

  /** Callback fired when active panel changes (e.g. for status bar updates). */
  public onPanelFocused: (() => void) | null = null;

  constructor(screen: blessed.Widgets.Screen, theme: Theme, config: AppConfig) {
    this.screen = screen;
    this.theme = theme;
    this.config = config;
  }

  /** Attach click-to-focus handler on a panel. */
  private attachMouseFocus(panel: Panel, index: number): void {
    panel.onMouseClick = () => {
      if (this.activePanelIndex !== index) {
        this.setActivePanel(index);
        if (this.onPanelFocused) this.onPanelFocused();
      }
    };
  }

  async initialize(initialPath: string, panelCount: LayoutMode = 2): Promise<void> {
    this._mode = panelCount;
    this.workingDir = initialPath;
    const positions = this.calculatePositions(panelCount);

    for (let i = 0; i < panelCount; i++) {
      const panel = new FilePanel(
        this.screen,
        this.theme,
        i,
        initialPath,
        positions[i],
      );
      this.panels.push(panel);
      this.attachMouseFocus(panel, i);
      await panel.loadDirectory();
    }

    this.setActivePanel(0);
  }

  private calculatePositions(count: LayoutMode): PanelPosition[] {
    const top = 0;
    const reservedBottom = 3;
    const height = `100%-${reservedBottom}`;

    switch (count) {
      case 2:
        return [
          { top, left: 0, width: '50%', height },
          { top, left: '50%', width: '50%', height },
        ];
      case 3:
        return [
          { top, left: 0, width: '33%', height },
          { top, left: '33%', width: '34%', height },
          { top, left: '67%', width: '33%', height },
        ];
      case 4:
        return [
          { top, left: 0, width: '50%', height: '50%-1' },
          { top, left: '50%', width: '50%', height: '50%-1' },
          { top: '50%-1', left: 0, width: '50%', height: '50%-2' },
          { top: '50%-1', left: '50%', width: '50%', height: '50%-2' },
        ];
    }
  }

  setActivePanel(index: number): void {
    if (index < 0 || index >= this.panels.length) return;

    for (let i = 0; i < this.panels.length; i++) {
      this.panels[i].setFocus(i === index);
    }
    this.activePanelIndex = index;
  }

  cyclePanel(): void {
    const next = (this.activePanelIndex + 1) % this.panels.length;
    this.setActivePanel(next);
  }

  /** Convert a file panel to a terminal panel. Returns the new TerminalPanel. */
  convertToTerminal(panelIndex: number): TerminalPanel {
    const old = this.panels[panelIndex];
    const pos = {
      top: old.box.top,
      left: old.box.left,
      width: old.box.width,
      height: old.box.height,
    } as PanelPosition;

    // Use the file panel's current directory if available
    const cwd = old instanceof FilePanel ? old.currentPath : this.workingDir;

    old.destroy();

    const tp = new TerminalPanel(
      this.screen,
      this.theme,
      panelIndex,
      cwd,
      pos,
      this.config,
    );
    this.panels[panelIndex] = tp;
    this.attachMouseFocus(tp, panelIndex);

    if (this.activePanelIndex === panelIndex) {
      tp.setFocus(true);
    }

    this.screen.render();
    return tp;
  }

  /** Convert a terminal panel back to a file panel. */
  async convertToFile(panelIndex: number, initialPath?: string): Promise<FilePanel> {
    const old = this.panels[panelIndex];
    const pos = {
      top: old.box.top,
      left: old.box.left,
      width: old.box.width,
      height: old.box.height,
    } as PanelPosition;

    old.destroy();

    const fp = new FilePanel(
      this.screen,
      this.theme,
      panelIndex,
      initialPath ?? this.workingDir,
      pos,
    );
    this.panels[panelIndex] = fp;
    this.attachMouseFocus(fp, panelIndex);
    await fp.loadDirectory();

    if (this.activePanelIndex === panelIndex) {
      fp.setFocus(true);
    }

    this.screen.render();
    return fp;
  }

  isTerminalPanel(index: number): boolean {
    return this.panels[index] instanceof TerminalPanel;
  }

  getTerminalPanel(index: number): TerminalPanel | null {
    const p = this.panels[index];
    return p instanceof TerminalPanel ? p : null;
  }

  get panelCount(): number {
    return this.panels.length;
  }

  /** Add a new file panel. Returns true if added, false if at max (4). */
  async addPanel(): Promise<boolean> {
    if (this.panels.length >= 4) return false;

    const newCount = (this.panels.length + 1) as LayoutMode;
    const positions = this.calculatePositions(newCount);

    // Reposition existing panels
    for (let i = 0; i < this.panels.length; i++) {
      this.panels[i].resize(positions[i]);
    }

    // Create new file panel
    const newPanel = new FilePanel(
      this.screen,
      this.theme,
      this.panels.length,
      this.workingDir,
      positions[this.panels.length],
    );
    this.panels.push(newPanel);
    this.attachMouseFocus(newPanel, this.panels.length - 1);
    await newPanel.loadDirectory();

    this._mode = newCount;
    this.screen.render();
    return true;
  }

  /** Remove a panel. Returns true if removed, false if at min (2). */
  removePanel(index?: number): boolean {
    if (this.panels.length <= 2) return false;

    const idx = index ?? this.activePanelIndex;
    if (idx < 0 || idx >= this.panels.length) return false;

    // Destroy the panel (kills agent if terminal)
    this.panels[idx].destroy();
    this.panels.splice(idx, 1);

    // Update panel indices and re-attach mouse focus handlers
    for (let i = 0; i < this.panels.length; i++) {
      const panel = this.panels[i];
      if (panel instanceof TerminalPanel) {
        panel.updatePanelIndex(i);
      } else {
        panel.panelIndex = i;
      }
      this.attachMouseFocus(panel, i);
    }

    // Reposition remaining panels
    const newCount = this.panels.length as LayoutMode;
    const positions = this.calculatePositions(newCount);
    for (let i = 0; i < this.panels.length; i++) {
      this.panels[i].resize(positions[i]);
    }

    // Clamp active panel index
    if (this.activePanelIndex >= this.panels.length) {
      this.activePanelIndex = this.panels.length - 1;
    }
    this.setActivePanel(this.activePanelIndex);

    this._mode = newCount;
    this.screen.render();
    return true;
  }

  async setMode(mode: LayoutMode): Promise<void> {
    if (mode === this._mode) return;

    // Destroy all panels
    for (const panel of this.panels) {
      panel.destroy();
    }
    this.panels = [];

    this._mode = mode;
    const positions = this.calculatePositions(mode);

    for (let i = 0; i < mode; i++) {
      const panel = new FilePanel(
        this.screen,
        this.theme,
        i,
        this.workingDir,
        positions[i],
      );
      this.panels.push(panel);
      this.attachMouseFocus(panel, i);
      await panel.loadDirectory();
    }

    if (this.activePanelIndex >= mode) {
      this.activePanelIndex = 0;
    }
    this.setActivePanel(this.activePanelIndex);
    this.screen.render();
  }

  /** Reset to initial state: kill all agents, 2 file panels at workingDir. */
  async resetToDefault(): Promise<void> {
    // Destroy all existing panels (kills agents)
    for (const panel of this.panels) {
      panel.destroy();
    }
    this.panels = [];

    this._mode = 2;
    this.activePanelIndex = 0;
    const positions = this.calculatePositions(2);

    for (let i = 0; i < 2; i++) {
      const panel = new FilePanel(
        this.screen,
        this.theme,
        i,
        this.workingDir,
        positions[i],
      );
      this.panels.push(panel);
      this.attachMouseFocus(panel, i);
      await panel.loadDirectory();
    }

    this.setActivePanel(0);
    this.screen.render();
  }

  async refreshAll(): Promise<void> {
    for (const panel of this.panels) {
      if (panel instanceof FilePanel) {
        await panel.loadDirectory();
      }
    }
  }

  handleResize(): void {
    const positions = this.calculatePositions(this._mode);
    for (let i = 0; i < this.panels.length; i++) {
      this.panels[i].resize(positions[i]);
    }
    this.screen.render();
  }
}
