import blessed from 'blessed';
import path from 'node:path';
import type { AppConfig, Theme } from './config/types.js';
import { getTheme } from './config/themes.js';
import { loadConfig } from './config/loader.js';
import { LayoutManager } from './screen/layout-manager.js';
import { createFunctionBar } from './screen/function-bar.js';
import { createStatusBar, updateStatusBar } from './screen/status-bar.js';
import { showHelpDialog } from './screen/dialog/help-dialog.js';
import { showConfirmDialog } from './screen/dialog/confirm-dialog.js';
import { showInputDialog } from './screen/dialog/input-dialog.js';
import { showAgentDialog } from './screen/dialog/agent-dialog.js';
import { showLogDialog } from './screen/dialog/log-dialog.js';
import { showOrchestrateDialog } from './screen/dialog/orchestrate-dialog.js';
import { showTemplateDialog } from './screen/dialog/template-dialog.js';
import { showProtocolGuide } from './screen/dialog/protocol-dialog.js';
import { Orchestrator } from './orchestration/orchestrator.js';
import { PreviewPanel } from './panels/preview-panel.js';
import { FilePanel } from './panels/file-panel.js';
import { TerminalPanel } from './panels/terminal-panel.js';
import { MarkdownEditor } from './editor/markdown-editor.js';
import { AgentManager } from './agents/agent-manager.js';
import { copyFiles, moveFiles, deleteFiles, createDirectory } from './file-manager/file-operations.js';
import { startWatching, stopWatching } from './file-manager/file-watcher.js';
import { appEvents } from './utils/events.js';
import { formatDate } from './utils/format.js';
import { logger } from './utils/logger.js';
import { isDialogActive } from './utils/dialog-state.js';
import { showToast, showErrorToast } from './screen/toast.js';
import { showWelcomeDialog } from './screen/dialog/welcome-dialog.js';
import { buildVimLaunchSpec, resolveCtrlGAction } from './utils/shortcut-routing.js';

export class App {
  private screen!: blessed.Widgets.Screen;
  private config: AppConfig;
  private theme: Theme;
  private layout!: LayoutManager;
  private agentManager: AgentManager;
  private orchestrator!: Orchestrator;
  private statusBar!: blessed.Widgets.BoxElement;
  private functionBar!: blessed.Widgets.BoxElement;
  private workingDir: string;

  constructor(workingDir?: string, overrides?: { theme?: string; panels?: number; showHidden?: boolean }) {
    this.config = loadConfig();
    if (overrides?.theme) this.config.theme = overrides.theme;
    if (overrides?.panels && [2, 3, 4].includes(overrides.panels)) {
      this.config.panelCount = overrides.panels as 2 | 3 | 4;
    }
    if (overrides?.showHidden !== undefined) this.config.showHidden = overrides.showHidden;
    this.theme = getTheme(this.config.theme);
    this.workingDir = workingDir || process.cwd();
    this.agentManager = new AgentManager();
  }

  async run(): Promise<void> {
    // Catch blessed rendering errors (orphaned children, null parent, etc.)
    // These are non-fatal — the screen recovers on next render cycle.
    process.on('uncaughtException', (err) => {
      if (err instanceof TypeError && err.stack?.includes('blessed')) {
        logger.error('blessed render error (suppressed)', err);
        return;
      }
      // Re-throw non-blessed errors
      logger.error('Uncaught exception', err);
      process.exit(1);
    });

    // Prevent unhandled promise rejections from crashing the process.
    // These can happen when async key handlers fail (e.g. agent stdin closes
    // during protocol injection).
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection (suppressed)', reason);
    });

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: 'Agents Commander',
      cursor: {
        artificial: true,
        shape: 'block',
        blink: true,
        color: 'cyan',
      },
    });

    this.functionBar = createFunctionBar(this.screen, this.theme);
    this.statusBar = createStatusBar(this.screen, this.theme);

    this.layout = new LayoutManager(this.screen, this.theme, this.config);
    await this.layout.initialize(this.workingDir, this.config.panelCount);
    this.orchestrator = new Orchestrator(this.layout, this.agentManager, this.screen, this.config);

    // Update status bar when panel is focused via mouse click
    this.layout.onPanelFocused = () => {
      this.updateStatus();
      this.screen.render();
    };

    startWatching(this.workingDir, this.config.watchDebounce);

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    appEvents.on('file:changed', () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        try {
          this.layout.refreshAll();
        } catch (err) {
          logger.error('Failed to refresh layout after file change', err);
        }
      }, 250); // Throttle refreshes to max 4 per second
    });

    this.setupGlobalKeys();
    this.updateStatus();

    this.screen.on('resize', () => {
      this.layout.handleResize();
    });

    this.screen.render();
    logger.info('Agents Commander started', { cwd: this.workingDir });

    // Show welcome splash on startup
    await showWelcomeDialog(this.screen, this.theme);
  }

  // ── Menu actions ──────────────────────────────────────────────

  private actionHelp(): void {
    showHelpDialog(this.screen, this.theme);
  }

  private async actionAddPanel(): Promise<void> {
    const added = await this.layout.addPanel();
    if (added) this.updateStatus();
  }

  private async actionViewFile(): Promise<void> {
    const fp = this.layout.activeFilePanel;
    if (!fp) {
      showErrorToast(this.screen, 'Switch to a file panel first');
      return;
    }
    const entry = fp.currentEntry;
    if (!entry || entry.isDirectory) {
      showErrorToast(this.screen, 'Select a file to view');
      return;
    }
    const preview = new PreviewPanel(
      this.screen,
      this.theme,
      { top: 0, left: 0, width: '100%', height: '100%' },
      () => {
        this.layout.activePanel.setFocus(true);
      },
    );
    await preview.loadFile(entry.fullPath);
    preview.focus();
  }

  private async actionEditFile(): Promise<void> {
    const fp = this.layout.activeFilePanel;
    if (!fp) {
      showErrorToast(this.screen, 'Switch to a file panel first');
      return;
    }
    const entry = fp.currentEntry;
    if (!entry || entry.isDirectory) {
      showErrorToast(this.screen, 'Select a file to edit');
      return;
    }
    await this.openEditor(entry.fullPath);
  }

  private async actionEditInVim(): Promise<boolean> {
    const fp = this.layout.activeFilePanel;
    const entry = fp?.currentEntry;
    if (!fp || !entry || entry.isDirectory) {
      return false;
    }

    const panelIndex = this.layout.allPanels.indexOf(fp);
    if (panelIndex === -1) {
      return false;
    }

    const panelPath = fp.currentPath;
    const spec = buildVimLaunchSpec(entry.fullPath);
    const tp = this.layout.convertToTerminal(panelIndex);
    const launched = tp.launchCommand(spec.label, spec.command, spec.args, {}, {
      onExit: () => {
        void this.restoreFilePanelAfterVim(panelIndex, panelPath, entry.fullPath);
      },
    });

    if (!launched) {
      const restored = await this.layout.convertToFile(panelIndex, panelPath);
      restored.focusEntry(entry.fullPath);
      showErrorToast(this.screen, `Unable to launch ${spec.command}`);
      this.updateStatus();
      return false;
    }

    this.updateStatus();
    this.screen.render();
    return true;
  }

  private async restoreFilePanelAfterVim(
    panelIndex: number,
    panelPath: string,
    filePath: string,
  ): Promise<void> {
    const fp = await this.layout.convertToFile(panelIndex, panelPath);
    fp.focusEntry(filePath);
    this.updateStatus();
  }

  private async actionCopy(): Promise<void> {
    const fp = this.layout.activeFilePanel;
    if (!fp) {
      showErrorToast(this.screen, 'Switch to a file panel first');
      return;
    }
    const entries = fp.selectedEntries;
    if (entries.length === 0) {
      showErrorToast(this.screen, 'Select a file to copy');
      return;
    }
    const target = this.layout.inactiveFilePanel;
    if (!target) {
      showErrorToast(this.screen, 'No target file panel — need two file panels');
      return;
    }

    const confirmed = await showConfirmDialog(
      this.screen, this.theme, 'Copy',
      `Copy ${entries.length} item(s) to ${target.currentPath}?`,
    );
    if (confirmed) {
      try {
        await copyFiles(entries.map((e) => e.fullPath), target.currentPath);
        await this.layout.refreshAll();
      } catch (err) {
        logger.error('Copy failed', err);
      }
    }
  }

  private async actionMove(): Promise<void> {
    const fp = this.layout.activeFilePanel;
    if (!fp) {
      showErrorToast(this.screen, 'Switch to a file panel first');
      return;
    }
    const entries = fp.selectedEntries;
    if (entries.length === 0) {
      showErrorToast(this.screen, 'Select a file to move');
      return;
    }

    if (entries.length === 1) {
      const newName = await showInputDialog(
        this.screen, this.theme, 'Rename/Move', 'New name:', entries[0].name,
      );
      if (newName) {
        const target = this.layout.inactiveFilePanel;
        const destDir = target ? target.currentPath : fp.currentPath;
        try {
          const { moveFile } = await import('./file-manager/file-operations.js');
          await moveFile(entries[0].fullPath, path.join(destDir, newName));
          await this.layout.refreshAll();
        } catch (err) {
          logger.error('Move failed', err);
        }
      }
    } else {
      const target = this.layout.inactiveFilePanel;
      if (!target) {
        showErrorToast(this.screen, 'No target file panel — need two file panels');
        return;
      }
      const confirmed = await showConfirmDialog(
        this.screen, this.theme, 'Move',
        `Move ${entries.length} item(s) to ${target.currentPath}?`,
      );
      if (confirmed) {
        try {
          await moveFiles(entries.map((e) => e.fullPath), target.currentPath);
          await this.layout.refreshAll();
        } catch (err) {
          logger.error('Move failed', err);
        }
      }
    }
  }

  private async actionMkdir(): Promise<void> {
    const fp = this.layout.activeFilePanel;
    if (!fp) {
      showErrorToast(this.screen, 'Switch to a file panel first');
      return;
    }
    const name = await showInputDialog(this.screen, this.theme, 'Create Directory', 'Directory name:');
    if (name) {
      try {
        await createDirectory(path.join(fp.currentPath, name));
        await fp.loadDirectory();
      } catch (err) {
        logger.error('Mkdir failed', err);
      }
    }
  }

  private async actionDelete(): Promise<void> {
    const fp = this.layout.activeFilePanel;
    if (!fp) {
      showErrorToast(this.screen, 'Switch to a file panel first');
      return;
    }
    const entries = fp.selectedEntries;
    if (entries.length === 0) {
      showErrorToast(this.screen, 'Select a file to delete');
      return;
    }

    const names = entries.map((e) => e.name).join(', ');
    const confirmed = await showConfirmDialog(
      this.screen, this.theme, 'Delete',
      `Delete ${entries.length} item(s)? ${entries.length <= 3 ? names : ''}`,
    );
    if (confirmed) {
      try {
        await deleteFiles(entries.map((e) => e.fullPath));
        await fp.loadDirectory();
      } catch (err) {
        logger.error('Delete failed', err);
      }
    }
  }

  private async actionLaunchAgent(): Promise<void> {
    const screen = this.screen;
    const choice = await showAgentDialog(
      screen,
      this.theme,
      this.layout.panelCount,
      this.layout.allPanels.indexOf(this.layout.activePanel),
    );

    if (choice) {
      const { agentType, panelIndex } = choice;
      let tp = this.layout.getTerminalPanel(panelIndex);
      if (!tp) {
        tp = this.layout.convertToTerminal(panelIndex);
      }
      const ok = this.agentManager.launchAgent(agentType, tp);
      if (ok) {
        this.orchestrator.connectPanel(tp);
        this.layout.setActivePanel(panelIndex);
        this.updateStatus();
      }
      screen.render();
    }
  }

  private async actionBrowseTemplates(): Promise<void> {
    const screen = this.screen;
    const choice = await showTemplateDialog(
      screen,
      this.theme,
      this.layout.panelCount,
      this.layout.allPanels.indexOf(this.layout.activePanel),
    );

    if (!choice) return;

    const { content, panelIndex, templateName } = choice;

    // Check if a managed agent is running on the target panel
    const managedAgent = this.agentManager.getAgentType(panelIndex);

    if (managedAgent) {
      // Managed agent already running — send content directly via orchestrator
      const result = await this.orchestrator.sendTask(managedAgent, panelIndex, content);
      if (!result.success) {
        logger.error(`Template send failed: ${result.error}`);
        showErrorToast(screen, `Failed to send template: ${result.error}`);
      } else {
        showToast(screen, `Template "${templateName}" sent to Panel ${panelIndex + 1}`);
      }
    } else {
      // No managed agent — pick one (kills any non-agent session on that panel)
      const agentChoice = await showAgentDialog(
        screen,
        this.theme,
        this.layout.panelCount,
        panelIndex,
      );
      if (agentChoice) {
        const targetPanel = agentChoice.panelIndex;
        // Kill any non-agent session (vim, shell) before launching the agent
        const existingTp = this.layout.getTerminalPanel(targetPanel);
        if (existingTp?.isRunning && !this.agentManager.isAgentRunning(targetPanel)) {
          existingTp.killAgent(true);
          this.orchestrator.disconnectPanel(targetPanel);
        }
        const result = await this.orchestrator.sendTask(
          agentChoice.agentType,
          targetPanel,
          content,
        );
        if (!result.success) {
          logger.error(`Template send failed: ${result.error}`);
          showErrorToast(screen, `Failed to send template: ${result.error}`);
        } else {
          showToast(screen, `Template "${templateName}" sent to ${agentChoice.agentType} in Panel ${targetPanel + 1}`);
        }
      }
    }

    this.updateStatus();
    screen.render();
  }

  private async actionQuit(): Promise<void> {
    const running = this.agentManager.getRunningAgents();
    const msg = running.length > 0
      ? `${running.length} agent(s) running. Exit anyway?`
      : 'Exit Agents Commander?';
    const confirmed = await showConfirmDialog(this.screen, this.theme, 'Quit', msg);
    if (confirmed) {
      this.shutdown();
    }
  }

  // ── Key bindings ────────────────────────────────────────────────

  private setupGlobalKeys(): void {
    const screen = this.screen;

    // Guard: skip global keys when a dialog is open.
    // Catches rejected promises from async handlers to prevent unhandled
    // rejections from crashing the process.
    const guard = (action: () => void | Promise<void>) => {
      return () => {
        if (isDialogActive()) return;
        try {
          const result = action();
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((err) => {
              logger.error('Async key handler error', err);
            });
          }
        } catch (err) {
          logger.error('Key handler error', err);
        }
      };
    };

    // Terminal-aware guard: also skip when a running terminal session is focused.
    // Keys using termGuard are NOT in RESERVED_KEYS, so they pass through to
    // the agent (vim, bash, etc.) instead of triggering app actions.
    // User can Tab to a file panel to access these shortcuts.
    const termGuard = (action: () => void | Promise<void>) => {
      return () => {
        if (isDialogActive()) return;
        if (this.layout.activeTerminalPanel?.isRunning) return;
        try {
          const result = action();
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((err) => {
              logger.error('Async termGuard handler error', err);
            });
          }
        } catch (err) {
          logger.error('termGuard handler error', err);
        }
      };
    };

    // Tab - switch panels
    screen.key(['tab'], guard(() => {
      this.layout.cyclePanel();
      this.updateStatus();
      screen.render();
    }));

    // F-keys (work everywhere, but not during dialogs)
    // Layout: F1=Help F2=Agent F3=+Panel F4=View F5=Edit F6=Copy F7=Move F8=Mkdir F9=Del F10=Quit
    screen.key(['f1'], guard(() => this.actionHelp()));
    screen.key(['f2'], guard(() => this.actionLaunchAgent()));
    screen.key(['f3'], guard(() => this.actionAddPanel()));
    screen.key(['f4'], guard(() => this.actionViewFile()));
    screen.key(['f5'], guard(() => this.actionEditFile()));
    screen.key(['f6'], guard(() => this.actionCopy()));
    screen.key(['f7'], guard(() => this.actionMove()));
    screen.key(['f8'], guard(() => this.actionMkdir()));
    screen.key(['f9'], guard(() => this.actionDelete()));
    screen.key(['f10'], guard(() => this.actionQuit()));

    // Ctrl+W - Remove active panel
    screen.key(['C-w'], guard(() => {
      if (this.layout.panelCount <= 2) return;
      const idx = this.layout.allPanels.indexOf(this.layout.activePanel);
      const tp = this.layout.getTerminalPanel(idx);
      if (tp?.isRunning) {
        if (this.agentManager.isAgentRunning(tp.panelIndex)) {
          this.agentManager.killAgent(tp.panelIndex);
        } else {
          tp.killAgent(true);
        }
      }
      if (tp) {
        this.orchestrator.disconnectPanel(idx);
      }
      const removed = this.layout.removePanel();
      if (removed) {
        this.agentManager.reindexAfterPanelRemoval(idx);
        this.orchestrator.reindexAfterPanelRemoval(idx);
      }
      this.updateStatus();
    }));

    // Ctrl+K - Kill agent on active terminal panel
    screen.key(['C-k'], guard(async () => {
      const tp = this.layout.activeTerminalPanel;
      if (tp && tp.isRunning) {
        const confirmed = await showConfirmDialog(
          screen, this.theme, 'Kill Session',
          'Terminate the running session?',
        );
        if (confirmed) {
          if (this.agentManager.isAgentRunning(tp.panelIndex)) {
            this.agentManager.killAgent(tp.panelIndex);
          } else {
            tp.killAgent();
          }
          this.orchestrator.disconnectPanel(tp.panelIndex);
          screen.render();
        }
      }
    }));

    // Ctrl+B - Browse prompt templates
    screen.key(['C-b'], guard(() => this.actionBrowseTemplates()));

    // Ctrl+G - Edit selected file in Vim from a file panel.
    // On running terminal sessions it passes through to the process.
    screen.key(['C-g'], termGuard(async () => {
      const activeFilePanel = this.layout.activeFilePanel;
      const action = resolveCtrlGAction({
        activePanel: activeFilePanel ? 'file' : this.layout.activeTerminalPanel ? 'terminal' : 'other',
        hasSelectedFile: !!activeFilePanel?.currentEntry && !activeFilePanel.currentEntry.isDirectory,
        terminalRunning: !!this.layout.activeTerminalPanel?.isRunning,
      });

      if (action === 'open-vim') {
        await this.actionEditInVim();
        return;
      }

      if (action === 'show-guide') {
        showProtocolGuide(screen, this.theme);
      }
    }));

    // F12 - Inter-agent communication guide (F11 is captured by macOS)
    screen.key(['f12'], guard(() => {
      showProtocolGuide(screen, this.theme);
    }));

    // Ctrl+O - Orchestrate: send task to another agent
    screen.key(['C-o'], guard(async () => {
      const choice = await showOrchestrateDialog(
        screen,
        this.theme,
        this.layout.panelCount,
        this.layout.allPanels.indexOf(this.layout.activePanel),
      );

      if (choice) {
        const result = await this.orchestrator.sendTask(
          choice.agentType,
          choice.panelIndex,
          choice.task,
        );
        if (!result.success) {
          logger.error(`Orchestrate failed: ${result.error}`);
        }
        this.updateStatus();
        screen.render();
      }
    }));

    // Ctrl+P - Inject protocol instructions into active agent
    let injecting = false;
    screen.key(['C-p'], guard(async () => {
      if (injecting) return; // prevent double-injection
      const tp = this.layout.activeTerminalPanel;
      if (!tp) {
        showErrorToast(screen, 'No terminal panel active');
        return;
      }
      if (!tp.isRunning) {
        showErrorToast(screen, 'No agent running on this panel');
        return;
      }
      injecting = true;
      try {
        const agentInfo = this.agentManager.getRunningAgents().find((a) => a.panelIndex === tp.panelIndex);
        showToast(screen, `Injecting protocol into ${agentInfo?.name ?? 'agent'}…`, 2000);
        screen.render();
        this.orchestrator.connectPanel(tp);
        await this.orchestrator.injectProtocol(tp);
        const agents = this.agentManager.getRunningAgents();
        const info = agents.find((a) => a.panelIndex === tp.panelIndex);
        showToast(screen, `Protocol injected into ${info?.name ?? 'agent'} [Panel ${tp.panelIndex + 1}]`);
      } catch (err) {
        logger.error('Protocol injection failed', err);
        showErrorToast(screen, 'Protocol injection failed — check logs');
      } finally {
        injecting = false;
      }
    }));

    // Ctrl+T - Convert active panel to terminal (or back to file)
    screen.key(['C-t'], guard(async () => {
      const idx = this.layout.allPanels.indexOf(this.layout.activePanel);
      if (this.layout.isTerminalPanel(idx)) {
        const tp = this.layout.getTerminalPanel(idx);
        if (tp?.isRunning) {
          const confirmed = await showConfirmDialog(
            screen, this.theme, 'Close Terminal',
            'A session is running. Kill it and switch back to a file panel?',
          );
          if (!confirmed) return;
          if (this.agentManager.isAgentRunning(idx)) {
            this.agentManager.killAgent(idx);
          } else {
            tp.killAgent(true);
          }
        }
        this.orchestrator.disconnectPanel(idx);
        await this.layout.convertToFile(idx);
      } else {
        this.layout.convertToTerminal(idx);
      }
      this.updateStatus();
      screen.render();
    }));

    // Ctrl+H - Toggle hidden files (termGuard: terminal backspace)
    screen.key(['C-h'], termGuard(() => {
      const fp = this.layout.activeFilePanel;
      if (fp) fp.toggleHidden();
    }));

    // Ctrl+R - Refresh (termGuard: bash reverse-search, vim redo)
    screen.key(['C-r'], termGuard(() => {
      this.layout.refreshAll();
    }));

    // Ctrl+L - Log viewer (termGuard: shell clear screen)
    screen.key(['C-l'], termGuard(() => {
      showLogDialog(screen, this.theme);
    }));

    // Ctrl+2/3/4 - Change layout
    const changeLayout = async (mode: 2 | 3 | 4) => {
      this.agentManager.killAll();
      this.orchestrator.resetState();
      await this.layout.setMode(mode);
      this.updateStatus();
    };
    screen.key(['C-2'], guard(() => changeLayout(2)));
    screen.key(['C-3'], guard(() => changeLayout(3)));
    screen.key(['C-4'], guard(() => changeLayout(4)));

    // Ctrl+E - Reset to default 2-panel file view (kills all agents)
    // termGuard: vim scroll-down uses C-e
    screen.key(['C-e'], termGuard(async () => {
      const running = this.agentManager.getRunningAgents();
      if (running.length > 0) {
        const confirmed = await showConfirmDialog(
          screen, this.theme, 'Reset View',
          `${running.length} agent(s) running. Kill all and reset?`,
        );
        if (!confirmed) return;
      }
      this.agentManager.killAll();
      this.orchestrator.resetState();
      await this.layout.resetToDefault();
      this.updateStatus();
      showToast(screen, 'Panels reset to default');
    }));

    // Update status on list navigation
    for (const panel of this.layout.allPanels) {
      if (panel instanceof FilePanel) {
        panel.list.on('select item', () => {
          this.updateStatus();
          screen.render();
        });
      }
    }
  }

  private updateStatus(): void {
    const panel = this.layout.activePanel;

    if (panel instanceof FilePanel) {
      const entry = panel.currentEntry;
      updateStatusBar(this.statusBar, {
        fileName: entry?.name ?? '..',
        fileSize: entry?.size,
        fileDate: entry ? formatDate(entry.modified) : undefined,
        dirPath: panel.currentPath,
        selectedCount: panel.selectedEntries.length,
      });
    } else if (panel instanceof TerminalPanel) {
      const agents = this.agentManager.getRunningAgents();
      const info = agents.find((a) => a.panelIndex === panel.panelIndex);
      updateStatusBar(this.statusBar, {
        fileName: info ? `${info.name} [${info.status}]` : panel.sessionName ? `${panel.sessionName} [${panel.status}]` : 'Terminal',
        dirPath: this.workingDir,
      });
    }

    this.screen.render();
  }

  private async openEditor(filePath: string): Promise<void> {
    const editor = new MarkdownEditor(
      this.screen,
      this.theme,
      filePath,
      () => {
        this.layout.refreshAll();
        this.layout.activePanel.setFocus(true);
      },
    );
    await editor.open();
  }

  private shutdown(): void {
    this.agentManager.killAll();
    for (const panel of this.layout.terminalPanels) {
      panel.killAgent(true);
    }
    stopWatching();
    logger.info('Agents Commander shutting down');
    logger.close();
    this.screen.destroy();
    process.exit(0);
  }
}
