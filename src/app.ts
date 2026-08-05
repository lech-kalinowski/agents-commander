import blessed from 'blessed';
import path from 'node:path';
import type { NormalizedAppConfig, Theme } from './config/types.js';
import { getTheme } from './config/themes.js';
import { loadConfig } from './config/loader.js';
import {
  resolveLaunchOptions,
  type ExplicitLaunchOptions,
  type ResolvedLaunchOptions,
} from './config/launch-options.js';
import { LayoutManager } from './screen/layout-manager.js';
import { createFunctionBar } from './screen/function-bar.js';
import { createStatusBar, updateStatusBar } from './screen/status-bar.js';
import { showHelpDialog } from './screen/dialog/help-dialog.js';
import {
  showConfirmDialog,
  type ConfirmDialogController,
} from './screen/dialog/confirm-dialog.js';
import { showInputDialog } from './screen/dialog/input-dialog.js';
import { showAgentDialog } from './screen/dialog/agent-dialog.js';
import { showLogDialog } from './screen/dialog/log-dialog.js';
import { showOrchestrateDialog } from './screen/dialog/orchestrate-dialog.js';
import { showTemplateDialog } from './screen/dialog/template-dialog.js';
import { showProtocolGuide } from './screen/dialog/protocol-dialog.js';
import {
  showActivityDialog,
  type ActivityDialogHandle,
} from './screen/dialog/activity-dialog.js';
import {
  Orchestrator,
  type TaskTargetExpectation,
} from './orchestration/orchestrator.js';
import { PreviewPanel } from './panels/preview-panel.js';
import { FilePanel } from './panels/file-panel.js';
import { TerminalPanel } from './panels/terminal-panel.js';
import { MarkdownEditor } from './editor/markdown-editor.js';
import {
  AgentManager,
  type AgentLifecycleEvent,
} from './agents/agent-manager.js';
import type { AgentType } from './agents/types.js';
import {
  createDemoAgentLaunchSpec,
  DEMO_AGENT_ROLES,
  DEMO_AGENT_ROLE_ORDER,
  type DemoAgentRole,
} from './demo/demo-agents.js';
import {
  copyFiles,
  moveFile,
  moveFiles,
  deleteFiles,
  createDirectory,
  validateEntryName,
} from './file-manager/file-operations.js';
import type { FileEntry } from './file-manager/types.js';
import { startWatching, stopWatching } from './file-manager/file-watcher.js';
import { appEvents } from './utils/events.js';
import { formatDate } from './utils/format.js';
import { logger } from './utils/logger.js';
import { closeDialogsForScreen, isDialogActive } from './utils/dialog-state.js';
import { showToast, showErrorToast } from './screen/toast.js';
import { showWelcomeDialog } from './screen/dialog/welcome-dialog.js';
import {
  showPanelNavigatorDialog,
  type PanelSummary,
} from './screen/dialog/panel-navigator-dialog.js';
import { buildVimLaunchSpec, resolveCtrlGAction } from './utils/shortcut-routing.js';
import { formatUserError, sanitizeUserText } from './utils/user-facing-errors.js';
import type { PanelDensity } from './panel-limits.js';
import {
  CODEX_MICRO_BINDINGS,
  type CodexMicroAction,
} from './hardware/codex-micro.js';
import {
  CodexMicroNativeBridge,
  type CodexMicroDeviceStatus,
  type CodexMicroHardwareEvent,
} from './hardware/codex-micro-native.js';
import {
  detectCodexDecision,
  type CodexDecisionAction,
} from './hardware/codex-decision.js';
import {
  showCodexMicroTestDialog,
  type CodexMicroTestDialogHandle,
} from './screen/dialog/codex-micro-test-dialog.js';

const RECOMMENDED_CONFERENCE_COLUMNS = 100;
const RECOMMENDED_CONFERENCE_ROWS = 24;
const CODEX_MICRO_DECISION_LEASE_MS = 5_000;
const CODEX_MICRO_CLOCK_SKEW_MS = 1_000;

interface PendingCodexMicroDecision {
  action: CodexDecisionAction;
  event: CodexMicroHardwareEvent;
  controller: ConfirmDialogController | null;
  expiresAt: number;
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface AppLaunchOptions extends ExplicitLaunchOptions {
  onShutdown?: () => void | Promise<void>;
  onSignalOwnership?: () => void;
}

export class App {
  private screen!: blessed.Widgets.Screen;
  private config: NormalizedAppConfig;
  private theme: Theme;
  private layout!: LayoutManager;
  private agentManager: AgentManager;
  private orchestrator!: Orchestrator;
  private statusBar!: blessed.Widgets.BoxElement;
  private functionBar!: blessed.Widgets.BoxElement;
  private workingDir: string;
  private launch: ResolvedLaunchOptions;
  private onShutdown?: () => void | Promise<void>;
  private onSignalOwnership?: () => void;
  private destructiveTransitionInProgress = false;
  private fullScreenOverlayActive = false;
  private shutdownPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private disposalStarted = false;
  private demoStarted = false;
  private demoPanelRoles = new Map<number, DemoAgentRole>();
  private demoRollbackPromise: Promise<void> | null = null;
  private activityDialog: ActivityDialogHandle | null = null;
  private codexMicroTestDialog: CodexMicroTestDialogHandle | null = null;
  private codexMicroBridge: CodexMicroNativeBridge | null = null;
  private codexMicroStatus: CodexMicroDeviceStatus = {
    state: 'starting',
    transport: 'unknown',
    connectionEpoch: null,
  };
  private pendingCodexMicroDecision: PendingCodexMicroDecision | null = null;
  private codexMicroKeyboardWarningShown = false;
  private unsubscribeCodexMicroStatus: (() => void) | null = null;
  private unsubscribeCodexMicroInput: (() => void) | null = null;
  private unsubscribeAgentLifecycle: (() => void) | null = null;
  private watcherStarted = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private fileChangedHandler: (() => void) | null = null;
  private processHandlersInstalled = false;

  private readonly handleUncaughtException = (err: Error): void => {
    if (err instanceof TypeError && err.stack?.includes('blessed')) {
      logger.error('blessed render error (suppressed)', err);
      return;
    }
    logger.error('Uncaught exception', err);
    void this.shutdown(1);
  };

  private readonly handleUnhandledRejection = (reason: unknown): void => {
    logger.error('Unhandled promise rejection (suppressed)', reason);
  };

  private readonly handleSigint = (): void => { void this.shutdown(130); };
  private readonly handleSighup = (): void => { void this.shutdown(129); };
  private readonly handleSigterm = (): void => { void this.shutdown(143); };

  constructor(workingDir?: string, options: AppLaunchOptions = {}) {
    this.launch = resolveLaunchOptions(loadConfig(), options);
    this.config = this.launch.config;
    this.theme = getTheme(this.config.theme);
    this.workingDir = workingDir || process.cwd();
    this.onShutdown = options.onShutdown;
    this.onSignalOwnership = options.onSignalOwnership;
    this.agentManager = new AgentManager(this.config.agents, this.config.agentProfiles);
  }

  async run(): Promise<void> {
    try {
      await this.runApplication();
    } catch (error) {
      try {
        await this.dispose();
      } catch (rollbackError) {
        logger.error('Application startup rollback failed', rollbackError);
      }
      logger.close();
      throw error;
    }
  }

  private installProcessHandlers(): void {
    if (this.processHandlersInstalled) return;
    this.processHandlersInstalled = true;
    process.on('uncaughtException', this.handleUncaughtException);
    process.on('unhandledRejection', this.handleUnhandledRejection);
    process.on('SIGINT', this.handleSigint);
    process.on('SIGHUP', this.handleSighup);
    process.on('SIGTERM', this.handleSigterm);
    const onSignalOwnership = this.onSignalOwnership;
    this.onSignalOwnership = undefined;
    onSignalOwnership?.();
  }

  private removeProcessHandlers(): void {
    if (!this.processHandlersInstalled) return;
    this.processHandlersInstalled = false;
    process.removeListener('uncaughtException', this.handleUncaughtException);
    process.removeListener('unhandledRejection', this.handleUnhandledRejection);
    process.removeListener('SIGINT', this.handleSigint);
    process.removeListener('SIGHUP', this.handleSighup);
    process.removeListener('SIGTERM', this.handleSigterm);
  }

  private async runApplication(): Promise<void> {
    this.installProcessHandlers();

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: this.launch.conference
        ? 'Agents Commander — Conference Mode'
        : 'Agents Commander',
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
    await this.layout.initialize(
      this.workingDir,
      this.config.panelCount,
      this.config.panelDensity,
    );
    this.layout.onOpenFile = (entry) => {
      void this.openPreview(entry).catch((err) => {
        logger.error(`Failed to preview file: ${entry.fullPath}`, err);
        showErrorToast(this.screen, formatUserError('Preview', err));
      });
    };
    this.orchestrator = new Orchestrator(this.layout, this.agentManager, this.screen, this.config);
    this.unsubscribeAgentLifecycle = this.agentManager.onLifecycle((event) => {
      this.handleAgentLifecycle(event);
      this.updateStatus();
    });

    // Update status bar when panel is focused via mouse click
    this.layout.onPanelFocused = () => {
      this.updateStatus();
      this.screen.render();
    };

    this.watcherStarted = true;
    startWatching(this.workingDir, this.config.watchDebounce);

    this.fileChangedHandler = () => {
      if (this.refreshTimer) return;
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        try {
          this.layout.refreshAll();
        } catch (err) {
          logger.error('Failed to refresh layout after file change', err);
        }
      }, 250); // Throttle refreshes to max 4 per second
    };
    appEvents.on('file:changed', this.fileChangedHandler);

    this.setupGlobalKeys();
    this.startCodexMicroNativeInput();
    this.updateStatus();

    this.screen.on('resize', () => {
      this.layout.handleResize();
      this.updateStatus();
    });

    this.screen.render();
    logger.info('Agents Commander started', { cwd: this.workingDir });

    if (!this.launch.skipWelcome) {
      await showWelcomeDialog(this.screen, this.theme);
    }
    this.warnCodexMicroKeyboardFallback();
    if (!this.disposalStarted && this.launch.demo) {
      await this.offerOfflineDemo();
    }
    if (!this.disposalStarted && this.launch.codexMicroTest) {
      this.openCodexMicroTest(false);
    }
  }

  // ── Menu actions ──────────────────────────────────────────────

  private actionHelp(): void {
    showHelpDialog(this.screen, this.theme);
  }

  private actionActivity(): void {
    const dialog = showActivityDialog(
      this.screen,
      this.theme,
      (limit) => this.orchestrator.getRecentActivity(limit),
    );
    if (dialog) this.activityDialog = dialog;
  }

  private openCodexMicroTest(markHardwareAction = true): void {
    this.codexMicroTestDialog = showCodexMicroTestDialog(this.screen, this.theme, {
      inputMode: this.config.hardware.codexMicro.inputMode,
      initialStatus: this.codexMicroStatus,
      decisionControls: this.config.hardware.codexMicro.decisionControls,
    });
    if (markHardwareAction) {
      this.codexMicroTestDialog.recordAction('open-test-overlay');
    }
  }

  private startCodexMicroNativeInput(): void {
    const micro = this.config.hardware.codexMicro;
    if (!micro.enabled || micro.inputMode !== 'native' || this.codexMicroBridge) return;

    const bridge = new CodexMicroNativeBridge();
    this.codexMicroBridge = bridge;
    this.unsubscribeCodexMicroStatus = bridge.onStatus((status) => {
      this.handleCodexMicroStatus(status);
    });
    this.unsubscribeCodexMicroInput = bridge.onInput((event) => {
      this.handleCodexMicroHardwareEvent(event);
    });
    bridge.start();
  }

  private warnCodexMicroKeyboardFallback(): void {
    const micro = this.config.hardware.codexMicro;
    if (
      this.codexMicroKeyboardWarningShown
      || this.disposalStarted
      || !micro.enabled
      || micro.inputMode !== 'keyboard'
    ) return;
    this.codexMicroKeyboardWarningShown = true;
    showErrorToast(
      this.screen,
      'Codex Micro keyboard fallback has NO reader guard; keep ChatGPT fully quit',
    );
  }

  private handleCodexMicroStatus(status: CodexMicroDeviceStatus): void {
    const previous = this.codexMicroStatus;
    this.codexMicroStatus = status;
    this.codexMicroTestDialog?.setDeviceStatus(status);

    const pending = this.pendingCodexMicroDecision;
    if (
      pending
      && (
        status.state !== 'connected'
        || status.ownership !== 'guarded'
        || status.connectionEpoch !== pending.event.connectionEpoch
      )
    ) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.controller?.cancel();
      this.pendingCodexMicroDecision = null;
    }

    if (
      !this.disposalStarted
      && status.state === 'busy'
      && previous.state !== 'busy'
    ) {
      showErrorToast(
        this.screen,
        'Codex Micro is open in ChatGPT or another app; Commander controls are paused',
      );
    } else if (
      !this.disposalStarted
      && previous.state !== 'connected'
      && status.state === 'connected'
      && status.ownership === 'guarded'
    ) {
      const transport = status.transport === 'unknown' ? '' : ` (${status.transport.toUpperCase()})`;
      showToast(this.screen, `Codex Micro ready for Commander${transport}`, 2000);
    } else if (
      !this.disposalStarted
      && previous.state === 'connected'
      && status.state !== 'connected'
    ) {
      showErrorToast(this.screen, 'Codex Micro disconnected; hardware actions are paused');
    }

    if (this.layout && this.statusBar && this.screen) this.updateStatus();
  }

  private isCurrentCodexMicroEvent(event: CodexMicroHardwareEvent): boolean {
    const now = Date.now();
    return this.codexMicroStatus.state === 'connected'
      && this.codexMicroStatus.ownership === 'guarded'
      && this.codexMicroStatus.connectionEpoch === event.connectionEpoch
      && event.receivedAt <= now + CODEX_MICRO_CLOCK_SKEW_MS
      && now - event.receivedAt <= CODEX_MICRO_DECISION_LEASE_MS;
  }

  private handleCodexMicroHardwareEvent(event: CodexMicroHardwareEvent): void {
    if (this.disposalStarted || !this.isCurrentCodexMicroEvent(event)) return;

    if (this.codexMicroTestDialog?.isOpen()) {
      this.codexMicroTestDialog.recordHardwareInput(event.input, event.action);
      return;
    }

    const pending = this.pendingCodexMicroDecision;
    if (pending) {
      if (Date.now() > pending.expiresAt) {
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingCodexMicroDecision = null;
        pending.controller?.cancel();
        showErrorToast(this.screen, 'Codex Micro confirmation expired; press the decision key again');
        return;
      }
      if (
        pending.action === event.action
        && pending.event.input === event.input
        && pending.event.connectionEpoch === event.connectionEpoch
        && event.sequence > pending.event.sequence
        && (event.action === 'approve' || event.action === 'reject')
      ) {
        pending.event = event;
        pending.controller?.confirm();
      }
      return;
    }

    if (
      this.destructiveTransitionInProgress
      || isDialogActive()
      || this.fullScreenOverlayActive
    ) return;

    try {
      const result = this.runCodexMicroAction(event.action, event);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => {
          logger.error('Codex Micro hardware action failed', error);
        });
      }
    } catch (error) {
      logger.error('Codex Micro hardware action failed', error);
    }
  }

  private currentCodexDecision(action: CodexDecisionAction): {
    terminal: TerminalPanel;
    sessionId: string;
    sessionGeneration: number;
    inputGeneration: bigint;
    fingerprint: string;
    selectedLabel: string;
  } | null {
    const terminal = this.layout.activeTerminalPanel;
    if (!terminal?.isRunning) return null;
    if (!terminal.inputSynchronized) return null;
    if (this.agentManager.getAgentType(terminal.panelIndex) !== 'codex') return null;
    const sessionId = this.agentManager.getAgentSessionId(terminal.panelIndex);
    if (!sessionId) return null;
    const inputGeneration = terminal.inputGeneration;
    const detected = detectCodexDecision(terminal.getVisibleGridLines(), action);
    if (
      !detected
      || !terminal.inputSynchronized
      || terminal.inputGeneration !== inputGeneration
    ) return null;
    return {
      terminal,
      sessionId,
      sessionGeneration: terminal.sessionGeneration,
      inputGeneration,
      fingerprint: detected.fingerprint,
      selectedLabel: detected.selectedLabel,
    };
  }

  private async actionCodexMicroDecision(
    action: CodexDecisionAction,
    hardwareEvent?: CodexMicroHardwareEvent,
  ): Promise<void> {
    if (this.config.hardware.codexMicro.inputMode !== 'native') {
      showErrorToast(
        this.screen,
        'Codex Micro decisions require native input with the sole-reader guard',
      );
      return;
    }
    if (
      this.codexMicroStatus.state !== 'connected'
      || this.codexMicroStatus.ownership !== 'guarded'
    ) {
      showErrorToast(this.screen, 'Codex Micro sole-reader guard is not active; no input was sent');
      return;
    }
    if (!this.config.hardware?.codexMicro.decisionControls) {
      showErrorToast(this.screen, 'Codex Micro decision controls are disabled in configuration');
      return;
    }
    if (hardwareEvent && !this.isCurrentCodexMicroEvent(hardwareEvent)) return;

    const expected = this.currentCodexDecision(action);
    if (!expected) {
      showErrorToast(
        this.screen,
        action === 'approve'
          ? 'Approve once requires a selected one-time option in the active managed Codex prompt'
          : 'Reject requires a selected reject option in the active managed Codex prompt',
      );
      return;
    }

    const title = action === 'approve' ? 'Codex Micro — Approve Once' : 'Codex Micro — Reject';
    const message = `Submit the currently selected Codex option “${expected.selectedLabel}”? `
      + 'Commander will send Enter only if the complete prompt is still unchanged.'
      + (hardwareEvent ? ' Press the same device key again within 5 seconds to confirm.' : '');
    let pending: PendingCodexMicroDecision | null = null;
    let confirmed: boolean;
    if (hardwareEvent) {
      pending = {
        action,
        event: hardwareEvent,
        controller: null,
        expiresAt: Date.now() + CODEX_MICRO_DECISION_LEASE_MS,
        timeout: null,
      };
      this.pendingCodexMicroDecision = pending;
      const decision = pending;
      decision.timeout = setTimeout(() => {
        if (this.pendingCodexMicroDecision !== decision) return;
        this.pendingCodexMicroDecision = null;
        decision.controller?.cancel();
        if (!this.disposalStarted) {
          showErrorToast(this.screen, 'Codex Micro confirmation expired; press the decision key again');
        }
      }, CODEX_MICRO_DECISION_LEASE_MS);
      decision.timeout.unref?.();
      try {
        confirmed = await showConfirmDialog(this.screen, this.theme, title, message, {
          externalConfirmOnly: true,
          onReady: (controller) => {
            if (this.pendingCodexMicroDecision === pending) pending!.controller = controller;
          },
        });
      } finally {
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.timeout = null;
        if (this.pendingCodexMicroDecision === pending) this.pendingCodexMicroDecision = null;
      }
    } else {
      confirmed = await showConfirmDialog(this.screen, this.theme, title, message);
    }
    if (!confirmed || this.disposalStarted) return;

    if (
      this.codexMicroStatus.state !== 'connected'
      || this.codexMicroStatus.ownership !== 'guarded'
    ) {
      showErrorToast(this.screen, 'Codex Micro sole-reader guard changed; no input was sent');
      return;
    }

    const confirmedHardwareEvent = pending?.event;
    if (
      confirmedHardwareEvent
      && (
        Date.now() > pending!.expiresAt
        || !this.isCurrentCodexMicroEvent(confirmedHardwareEvent)
      )
    ) {
      showErrorToast(this.screen, 'Codex Micro confirmation expired or disconnected; no input was sent');
      return;
    }

    const current = this.currentCodexDecision(action);
    if (
      !current
      || current.terminal !== expected.terminal
      || current.sessionId !== expected.sessionId
      || current.sessionGeneration !== expected.sessionGeneration
      || current.inputGeneration !== expected.inputGeneration
      || current.fingerprint !== expected.fingerprint
    ) {
      showErrorToast(this.screen, 'Codex prompt changed during confirmation; no input was sent');
      return;
    }

    const submitted = await this.orchestrator.submitGuardedCodexDecision(
      expected.terminal,
      {
        action,
        sessionId: expected.sessionId,
        sessionGeneration: expected.sessionGeneration,
        inputGeneration: expected.inputGeneration,
        fingerprint: expected.fingerprint,
        ...(confirmedHardwareEvent
          ? {
              validateOrigin: () => (
                Date.now() <= pending!.expiresAt
                && this.isCurrentCodexMicroEvent(confirmedHardwareEvent)
              ),
            }
          : {}),
      },
    );
    if (!submitted) {
      showErrorToast(this.screen, 'Codex prompt or session changed; no input was sent');
      return;
    }
    showToast(
      this.screen,
      action === 'approve' ? 'Submitted selected one-time approval' : 'Submitted selected rejection',
    );
  }

  private runCodexMicroAction(
    action: CodexMicroAction,
    hardwareEvent?: CodexMicroHardwareEvent,
  ): void | Promise<void> {
    switch (action) {
      case 'previous-panel':
        this.layout.focusPanelOffset(-1);
        break;
      case 'next-panel':
        this.layout.focusPanelOffset(1);
        break;
      case 'previous-page':
        this.layout.focusPageOffset(-1);
        break;
      case 'next-page':
        this.layout.focusPageOffset(1);
        break;
      case 'focus-slot-1':
      case 'focus-slot-2':
      case 'focus-slot-3':
      case 'focus-slot-4': {
        const slot = Number(action.at(-1));
        if (!this.layout.focusVisibleSlot(slot)) {
          showErrorToast(this.screen, `Visible panel slot ${slot} is unavailable`);
        }
        break;
      }
      case 'focus-panel-1':
      case 'focus-panel-2':
      case 'focus-panel-3':
      case 'focus-panel-4':
      case 'focus-panel-5':
      case 'focus-panel-6': {
        const slot = Number(action.at(-1));
        if (!this.layout.focusWorkspaceSlot(slot)) {
          showErrorToast(this.screen, `Active workspace slot ${slot} is unavailable`);
        }
        break;
      }
      case 'add-panel':
        return this.actionAddPanel();
      case 'cycle-density':
        return this.actionCyclePanelDensity();
      case 'open-navigator':
        return this.actionNavigatePanel();
      case 'open-activity':
        this.actionActivity();
        return;
      case 'approve':
      case 'reject':
        return this.actionCodexMicroDecision(action, hardwareEvent);
      case 'open-test-overlay':
        this.openCodexMicroTest();
        return;
    }
    this.updateStatus();
    this.screen.render();
  }

  private assertLaunchAllowed(action: string): void {
    if (this.disposalStarted) {
      throw new Error(`Cannot ${action}; application shutdown has begun`);
    }
  }

  private async waitForDemoRollback(): Promise<void> {
    while (this.demoRollbackPromise) {
      await this.demoRollbackPromise;
    }
  }

  private beginDemoRollback(panelIndices: readonly number[]): Promise<void> {
    const previous = this.demoRollbackPromise ?? Promise.resolve();
    const uniquePanelIndices = [...new Set(panelIndices)];
    const rollback = previous.then(async () => {
      await Promise.allSettled(
        uniquePanelIndices.map((panelIndex) => this.stopTerminalSession(panelIndex)),
      );
    });

    let tracked!: Promise<void>;
    tracked = rollback.finally(() => {
      if (this.demoRollbackPromise === tracked) {
        this.demoRollbackPromise = null;
      }
    });
    this.demoRollbackPromise = tracked;
    return tracked;
  }

  private async offerOfflineDemo(): Promise<void> {
    await this.waitForDemoRollback();
    if (this.disposalStarted) return;

    const confirmed = await showConfirmDialog(
      this.screen,
      this.theme,
      'Start Offline Conference Demo',
      'Launch two deterministic local demo agents now? The demo uses no network or API credentials.',
    );
    if (this.disposalStarted) return;
    if (!confirmed) {
      showToast(this.screen, 'Offline demo was not started — press Ctrl+O to retry');
      return;
    }

    try {
      await this.startOfflineDemo();
    } catch (error) {
      logger.error('Offline demo failed to start', error);
      if (this.disposalStarted) return;
      showErrorToast(
        this.screen,
        `Offline demo failed: ${sanitizeUserText(
          error instanceof Error ? error.message : String(error),
          160,
        )}. Press Ctrl+O to retry.`,
      );
    }
  }

  private async actionOrchestrateOrDemo(): Promise<void> {
    await this.waitForDemoRollback();
    if (this.disposalStarted) return;

    const demoRolesAreRunning = [...this.demoPanelRoles.keys()].some(
      (panelId) => this.hasLiveTerminalSession(panelId),
    );
    if (this.launch.demo && !demoRolesAreRunning) {
      this.demoStarted = false;
      await this.offerOfflineDemo();
      return;
    }
    await this.actionOrchestrate();
  }

  private async startOfflineDemo(): Promise<void> {
    await this.waitForDemoRollback();
    this.assertLaunchAllowed('start the offline demo');
    if (this.demoStarted) return;
    this.demoStarted = true;
    this.demoPanelRoles.clear();
    const launchedPanels: number[] = [];
    const terminals: TerminalPanel[] = [];

    try {
      while (this.layout.panelCount < DEMO_AGENT_ROLE_ORDER.length) {
        const added = await this.layout.addPanel();
        if (!added) throw new Error('Unable to create the two demo panels');
      }
      const demoPanelIds = this.layout.workspacePanelIds.slice(
        0,
        DEMO_AGENT_ROLE_ORDER.length,
      );

      for (let index = 0; index < DEMO_AGENT_ROLE_ORDER.length; index++) {
        this.assertLaunchAllowed('launch an offline demo role');
        const role = DEMO_AGENT_ROLE_ORDER[index];
        const panelId = demoPanelIds[index];
        if (this.hasLiveTerminalSession(panelId)) {
          await this.stopTerminalSession(panelId);
          this.assertLaunchAllowed('launch an offline demo role');
        }
        if (!this.layout.hasPanel(panelId)) {
          throw new Error(`Demo panel ${panelId + 1} is no longer available`);
        }
        const terminal = this.layout.convertToTerminal(panelId);

        // Register the role before launch so even an immediately failing child
        // is attributed to the demo rather than treated as a generic session.
        this.demoPanelRoles.set(panelId, role);
        const protocolCapability = this.orchestrator.createProtocolCapability();
        const launched = this.agentManager.launchInternalAgent(
          createDemoAgentLaunchSpec(role, undefined, protocolCapability),
          terminal,
        );
        if (!launched) {
          this.demoPanelRoles.delete(panelId);
          throw new Error(`Unable to launch the ${role} role`);
        }
        launchedPanels.push(panelId);
        terminals.push(terminal);
        this.orchestrator.connectPanel(terminal);
        if (!this.orchestrator.armInternalProtocol(terminal, protocolCapability)) {
          throw new Error(`Unable to arm Commander protocol for the ${role} role`);
        }
      }

      this.layout.setActivePanel(demoPanelIds[0]);
      this.updateStatus();
      this.screen.render();

      // Both scanner-enabled sessions are registered before the explicit
      // start token is sent, so the first SEND marker cannot outrun routing.
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      this.assertLaunchAllowed('send the offline demo START token');
      if (!await this.orchestrator.sendProgrammaticInput(terminals[0], 'START', true)) {
        throw new Error('Coordinator session closed before the START token was sent');
      }
      showToast(this.screen, 'Offline demo started — press F12 for routed activity');
    } catch (error) {
      this.demoStarted = false;
      this.demoPanelRoles.clear();
      await this.beginDemoRollback(launchedPanels);
      throw error;
    }
  }

  private handleAgentLifecycle(event: AgentLifecycleEvent): void {
    if (event.type !== 'exited') return;
    const role = this.demoPanelRoles.get(event.panelIndex);
    if (!role) return;
    this.demoPanelRoles.delete(event.panelIndex);

    const processFailed = event.reason === 'spawn-error'
      || (
        event.reason === 'process-exit'
        && (
          event.signal !== null
          || (event.exitCode !== null && event.exitCode !== 0)
        )
      );
    if (!processFailed) {
      if (event.reason !== 'process-exit') {
        this.demoStarted = false;
        const peerPanels = [...this.demoPanelRoles.keys()];
        this.demoPanelRoles.clear();
        void this.beginDemoRollback(peerPanels);
      }
      return;
    }
    if (!this.demoStarted) return;

    this.demoStarted = false;
    const peerPanels = [...this.demoPanelRoles.keys()];
    this.demoPanelRoles.clear();

    const detail = event.reason === 'spawn-error'
      ? ' (spawn error)'
      : event.signal
      ? ` (${event.signal})`
      : event.exitCode === null
        ? ''
        : ` (code ${event.exitCode})`;
    logger.error('Offline demo role exited unexpectedly', {
      role,
      panelIndex: event.panelIndex,
      exitCode: event.exitCode,
      signal: event.signal,
      reason: event.reason,
    });
    const rollback = this.beginDemoRollback(peerPanels);
    void rollback.then(() => {
      if (this.disposalStarted) return;
      showErrorToast(
        this.screen,
        `${DEMO_AGENT_ROLES[role].name} stopped unexpectedly${detail}. `
          + 'The peer was stopped; press Ctrl+O to retry.',
        5000,
      );
    });
  }

  private async actionAddPanel(): Promise<void> {
    const added = await this.layout.addPanel();
    if (added) this.updateStatus();
  }

  private getLiveTerminalSessions(): TerminalPanel[] {
    const managedPanels = new Set(
      this.agentManager.getRunningAgents().map((agent) => agent.panelIndex),
    );
    return this.layout.terminalPanels.filter(
      (panel) => panel.isRunning || managedPanels.has(panel.panelIndex),
    );
  }

  private getManagedSession(panelIndex: number) {
    return this.agentManager
      .getRunningAgents()
      .find((agent) => agent.panelIndex === panelIndex);
  }

  private hasLiveTerminalSession(panelIndex: number): boolean {
    return Boolean(
      this.layout.getTerminalPanel(panelIndex)?.isRunning ||
      this.getManagedSession(panelIndex),
    );
  }

  private async runDestructiveTransition(action: () => Promise<void>): Promise<void> {
    if (this.destructiveTransitionInProgress) return;
    this.destructiveTransitionInProgress = true;
    try {
      await action();
    } finally {
      this.destructiveTransitionInProgress = false;
    }
  }

  private async actionChangeLayout(mode: PanelDensity): Promise<void> {
    if (mode === this.layout.mode) return;

    await this.runDestructiveTransition(async () => {
      try {
        await this.layout.setMode(mode);
        this.updateStatus();
      } catch (err) {
        logger.error(`Failed to change panel density to ${mode}`, err);
        showErrorToast(this.screen, 'Panel density change failed — current view was preserved');
      }
    });
  }

  private async actionCyclePanelDensity(): Promise<void> {
    const densities: readonly PanelDensity[] = ['auto', 2, 3, 4];
    const currentIndex = densities.indexOf(this.layout.mode);
    const nextDensity = densities[(currentIndex + 1 + densities.length) % densities.length];
    await this.actionChangeLayout(nextDensity);
  }

  private async actionRemovePanel(): Promise<void> {
    if (this.layout.panelCount <= 1) return;

    await this.runDestructiveTransition(async () => {
      const panelId = this.layout.activePanel.panelIndex;
      const targetPanel = this.layout.getPanel(panelId);
      if (!targetPanel) return;
      const tp = this.layout.getTerminalPanel(panelId);
      if (this.hasLiveTerminalSession(panelId)) {
        const label = tp?.sessionName ? ` “${sanitizeUserText(tp.sessionName, 60)}”` : '';
        const confirmed = await showConfirmDialog(
          this.screen,
          this.theme,
          'Remove Panel',
          `Panel ${panelId + 1}${label} has a live session. Close it and remove the panel?`,
        );
        if (!confirmed) return;
        if (this.layout.getPanel(panelId) !== targetPanel) return;
      }

      try {
        await this.stopTerminalSession(panelId);
        if (this.layout.getPanel(panelId) !== targetPanel) return;

        const removed = this.layout.removePanel(panelId);
        if (removed) {
          this.agentManager.handlePanelRemoval(panelId);
          this.orchestrator.handlePanelRemoval(panelId);
          this.updateStatus();
        }
      } catch (err) {
        logger.error(`Failed to remove panel ${panelId + 1}`, err);
        showErrorToast(this.screen, `Unable to remove Panel ${panelId + 1}`);
      }
    });
  }

  private async actionResetView(): Promise<void> {
    await this.runDestructiveTransition(async () => {
      const liveSessions = this.getLiveTerminalSessions();
      if (liveSessions.length > 0) {
        const confirmed = await showConfirmDialog(
          this.screen,
          this.theme,
          'Reset View',
          `${liveSessions.length} live terminal session(s) will be closed. Reset to two file panels?`,
        );
        if (!confirmed) return;
      }

      try {
        await this.stopAllTerminalSessions();
        this.orchestrator.resetState();
        await this.layout.resetToDefault();
        this.updateStatus();
        showToast(this.screen, 'Panels reset to default');
      } catch (err) {
        logger.error('Failed to reset panel view', err);
        showErrorToast(this.screen, 'Unable to reset the panel view');
      }
    });
  }

  private async confirmSessionReplacement(panelIndex: number, nextAction: string): Promise<boolean> {
    const terminal = this.layout.getTerminalPanel(panelIndex);
    const managed = this.getManagedSession(panelIndex);
    if (!terminal?.isRunning && !managed) return true;
    const sessionName = terminal?.sessionName || managed?.name;
    const label = sessionName
      ? ` “${sanitizeUserText(sessionName, 60)}”`
      : '';
    return showConfirmDialog(
      this.screen,
      this.theme,
      'Replace Session',
      `Panel ${panelIndex + 1}${label} is running. Close it and ${nextAction}?`,
    );
  }

  private async confirmTaskTarget(
    agentType: AgentType,
    panelIndex: number,
    nextAction: string,
    profileId?: string,
  ): Promise<TaskTargetExpectation | null> {
    const targetExpectation = this.orchestrator.captureTaskTarget(panelIndex);
    if (!targetExpectation) return null;
    const terminal = this.layout.getTerminalPanel(panelIndex);
    const managed = this.getManagedSession(panelIndex);
    const reusesRunningAgent = Boolean(
      terminal?.isRunning &&
      managed?.type === agentType &&
      (profileId === undefined || managed.profileId === profileId),
    );

    if (reusesRunningAgent || (!terminal?.isRunning && !managed)) {
      return targetExpectation;
    }
    return await this.confirmSessionReplacement(panelIndex, nextAction)
      ? targetExpectation
      : null;
  }

  private async stopTerminalSession(panelIndex: number): Promise<void> {
    const terminal = this.layout.getTerminalPanel(panelIndex);
    let termination: Promise<void> = Promise.resolve();
    if (this.agentManager.hasAgent(panelIndex)) {
      termination = this.agentManager.killAgent(panelIndex);
    } else if (terminal) {
      termination = terminal.killAgent(true);
    }
    if (terminal) this.orchestrator.disconnectPanel(panelIndex);
    await termination;
  }

  private async stopAllTerminalSessions(): Promise<void> {
    const terminalPanels = [...this.layout.terminalPanels];
    const terminations: Array<Promise<void>> = [
      Promise.resolve(this.agentManager.killAll()),
      ...terminalPanels.map(
        (panel) => Promise.resolve(panel.killAgent(true)),
      ),
    ];
    await Promise.allSettled(terminations);
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
    await this.openPreview(entry);
  }

  private async openPreview(entry: FileEntry): Promise<void> {
    if (this.fullScreenOverlayActive) return;
    this.fullScreenOverlayActive = true;
    let released = false;
    const releaseOverlay = () => {
      if (released) return;
      released = true;
      // Keep the guard active until every listener for the closing key has run.
      queueMicrotask(() => {
        this.fullScreenOverlayActive = false;
        if (this.disposalStarted) return;
        this.layout.activePanel.setFocus(true);
      });
    };

    let preview: PreviewPanel | null = null;
    try {
      preview = new PreviewPanel(
        this.screen,
        this.theme,
        { top: 0, left: 0, width: '100%', height: '100%' },
        releaseOverlay,
      );
      preview.focus();
      await preview.loadFile(entry.fullPath);
    } catch (err) {
      releaseOverlay();
      preview?.close();
      throw err;
    }
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
    if (this.disposalStarted) return false;
    const fp = this.layout.activeFilePanel;
    const entry = fp?.currentEntry;
    if (!fp || !entry || entry.isDirectory) {
      return false;
    }

    const panelIndex = fp.panelIndex;

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
    if (this.disposalStarted) return;
    const fp = await this.layout.convertToFile(panelIndex, panelPath);
    if (this.disposalStarted) return;
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
        showToast(this.screen, `Copied ${entries.length} item(s)`);
      } catch (err) {
        logger.error('Copy failed', err);
        showErrorToast(this.screen, formatUserError('Copy', err));
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
        this.screen, this.theme, 'Rename', 'New name in this panel:', entries[0].name,
      );
      if (newName) {
        try {
          validateEntryName(newName);
        } catch (err) {
          logger.error('Invalid move destination name', err);
          showErrorToast(this.screen, formatUserError('Move', err));
          return;
        }
        try {
          // A single-item rename stays in the active panel. With paged
          // workspaces an arbitrary inactive panel may be hidden and point at
          // an unrelated directory; multi-item moves still show their target
          // path in an explicit confirmation dialog below.
          await moveFile(entries[0].fullPath, path.join(fp.currentPath, newName));
          await this.layout.refreshAll();
          showToast(this.screen, `Renamed “${sanitizeUserText(entries[0].name, 80)}”`);
        } catch (err) {
          logger.error('Move failed', err);
          showErrorToast(this.screen, formatUserError('Move', err));
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
          showToast(this.screen, `Moved ${entries.length} item(s)`);
        } catch (err) {
          logger.error('Move failed', err);
          showErrorToast(this.screen, formatUserError('Move', err));
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
        validateEntryName(name);
        await createDirectory(path.join(fp.currentPath, name));
        await fp.loadDirectory();
        showToast(this.screen, `Created directory “${sanitizeUserText(name, 80)}”`);
      } catch (err) {
        logger.error('Mkdir failed', err);
        showErrorToast(this.screen, formatUserError('Create directory', err));
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
    const deleteTargets = entries.map((entry) => {
      if (
        typeof entry.deviceId !== 'string'
        || !/^(?:0|[1-9]\d*)$/u.test(entry.deviceId)
        || typeof entry.inode !== 'string'
        || !/^(?:0|[1-9]\d*)$/u.test(entry.inode)
        || !Number.isFinite(entry.identityMode)
        || typeof entry.ctimeNs !== 'string'
        || !/^(?:0|[1-9]\d*)$/u.test(entry.ctimeNs)
      ) return null;
      return {
        path: entry.fullPath,
        deviceId: entry.deviceId,
        inode: entry.inode,
        mode: entry.identityMode as number,
        ctimeNs: entry.ctimeNs,
      };
    });
    if (deleteTargets.some((target) => target === null)) {
      showErrorToast(this.screen, 'Refresh the panel before deleting these items');
      return;
    }

    const names = entries.map((e) => e.name).join(', ');
    const confirmed = await showConfirmDialog(
      this.screen, this.theme, 'Delete',
      `Delete ${entries.length} item(s)? ${entries.length <= 3 ? names : ''}`,
    );
    if (confirmed) {
      try {
        await deleteFiles(deleteTargets.filter((target) => target !== null));
        await fp.loadDirectory();
        showToast(this.screen, `Deleted ${entries.length} item(s)`);
      } catch (err) {
        logger.error('Delete failed', err);
        showErrorToast(this.screen, formatUserError('Delete', err));
      }
    }
  }

  private async actionLaunchAgent(): Promise<void> {
    const screen = this.screen;
    const choice = await showAgentDialog(
      screen,
      this.theme,
      this.layout.workspacePanelIds,
      this.layout.activePanel.panelIndex,
      this.config.agents,
      this.config.agentProfiles,
    );

    if (this.disposalStarted) return;
    if (choice) {
      const { agentType, panelIndex } = choice;
      const profileId = choice.profileId ?? agentType;
      const targetPanel = this.layout.getPanel(panelIndex);
      if (!targetPanel) {
        showErrorToast(screen, `Panel ${panelIndex + 1} is no longer available`);
        return;
      }
      if (this.hasLiveTerminalSession(panelIndex)) {
        const confirmed = await this.confirmSessionReplacement(panelIndex, `launch ${agentType}`);
        if (!confirmed) return;
        if (this.layout.getPanel(panelIndex) !== targetPanel) return;
        await this.stopTerminalSession(panelIndex);
        if (this.disposalStarted || this.layout.getPanel(panelIndex) !== targetPanel) return;
        if (this.hasLiveTerminalSession(panelIndex)) {
          showErrorToast(
            screen,
            `Panel ${panelIndex + 1} started another session; launch was cancelled`,
          );
          return;
        }
      }
      const tp = this.layout.convertToTerminal(panelIndex);
      const ok = this.agentManager.launchProfile(profileId, tp);
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
      this.layout.workspacePanelIds,
      this.layout.activePanel.panelIndex,
    );

    if (this.disposalStarted) return;
    if (!choice) return;

    const { content, panelIndex, templateName, requiresProtocol } = choice;
    if (!this.layout.hasPanel(panelIndex)) {
      showErrorToast(screen, `Panel ${panelIndex + 1} is no longer available`);
      return;
    }
    const preparedTemplate = this.orchestrator.prepareTemplateTask(
      panelIndex,
      content,
      requiresProtocol,
    );
    if (!preparedTemplate.success) {
      showErrorToast(screen, preparedTemplate.error);
      return;
    }
    // Check if a managed agent is running on the target panel
    const managedAgent = this.getManagedSession(panelIndex)?.type ?? null;

    if (managedAgent) {
      // Managed agent already running — send content directly via orchestrator
      const targetExpectation = await this.confirmTaskTarget(
        managedAgent,
        panelIndex,
        `send template “${sanitizeUserText(templateName, 60)}”`,
      );
      if (!targetExpectation) return;
      if (this.disposalStarted || !this.layout.hasPanel(panelIndex)) return;
      const result = await this.orchestrator.sendTemplateTask(
        managedAgent,
        panelIndex,
        preparedTemplate,
        undefined,
        targetExpectation,
      );
      if (this.disposalStarted) return;
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
        this.layout.workspacePanelIds,
        panelIndex,
        this.config.agents,
        this.config.agentProfiles,
      );
      if (this.disposalStarted) return;
      if (agentChoice) {
        const targetPanel = agentChoice.panelIndex;
        if (!this.layout.hasPanel(targetPanel)) {
          showErrorToast(screen, `Panel ${targetPanel + 1} is no longer available`);
          return;
        }
        const targetExpectation = await this.confirmTaskTarget(
          agentChoice.agentType,
          targetPanel,
          `launch ${agentChoice.agentType} and send the template`,
          agentChoice.profileId,
        );
        if (!targetExpectation) return;
        if (this.disposalStarted || !this.layout.hasPanel(targetPanel)) return;
        const result = await this.orchestrator.sendTemplateTask(
          agentChoice.agentType,
          targetPanel,
          preparedTemplate,
          agentChoice.profileId,
          targetExpectation,
        );
        if (this.disposalStarted) return;
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

  private async actionOrchestrate(): Promise<void> {
    const choice = await showOrchestrateDialog(
      this.screen,
      this.theme,
      this.layout.workspacePanelIds,
      this.layout.activePanel.panelIndex,
      this.config.agents,
      this.config.agentProfiles,
    );

    if (this.disposalStarted) return;
    if (!choice) return;
    if (!this.layout.hasPanel(choice.panelIndex)) {
      showErrorToast(this.screen, `Panel ${choice.panelIndex + 1} is no longer available`);
      return;
    }

    const targetExpectation = await this.confirmTaskTarget(
      choice.agentType,
      choice.panelIndex,
      `launch ${choice.agentType} and send the task`,
      choice.profileId,
    );
    if (!targetExpectation) return;
    if (this.disposalStarted || !this.layout.hasPanel(choice.panelIndex)) return;

    const result = await this.orchestrator.sendTask(
      choice.agentType,
      choice.panelIndex,
      choice.task,
      choice.profileId,
      targetExpectation,
    );
    if (this.disposalStarted) return;
    if (!result.success) {
      logger.error(`Orchestrate failed: ${result.error}`);
      showErrorToast(
        this.screen,
        `Task delivery failed: ${result.error ?? 'unknown error'}`,
      );
    }
    this.updateStatus();
    this.screen.render();
  }

  private panelSummaries(): PanelSummary[] {
    const runningByPanel = new Map(
      this.agentManager.getRunningAgents().map((agent) => [agent.panelIndex, agent]),
    );

    return this.layout.allPanels.map((panel) => {
      const running = runningByPanel.get(panel.panelIndex);
      if (panel instanceof FilePanel) {
        return {
          panelId: panel.panelIndex,
          panelNumber: panel.panelIndex + 1,
          title: path.basename(panel.currentPath) || panel.currentPath,
          kind: 'files',
          status: panel.isVisible ? 'visible' : 'hidden',
          cwd: panel.currentPath,
        };
      }
      return {
        panelId: panel.panelIndex,
        panelNumber: panel.panelIndex + 1,
        title: running?.profileLabel ?? panel.sessionName ?? 'Terminal',
        kind: 'terminal',
        status: running?.status ?? panel.status,
        cwd: panel.workingDir,
        ...(running ? { agent: running.name } : {}),
        ...(running?.model ? { model: running.model } : {}),
      };
    });
  }

  private async actionNavigatePanel(): Promise<void> {
    const panelId = await showPanelNavigatorDialog(
      this.screen,
      this.theme,
      this.panelSummaries(),
      this.layout.activePanelId ?? undefined,
    );
    if (this.disposalStarted || panelId === null) return;
    if (!this.layout.hasPanel(panelId)) {
      showErrorToast(this.screen, `Panel ${panelId + 1} is no longer available`);
      return;
    }
    this.layout.setActivePanel(panelId);
    this.updateStatus();
    this.screen.render();
  }

  private async actionQuit(): Promise<void> {
    const running = this.getLiveTerminalSessions();
    const msg = running.length > 0
      ? `${running.length} live terminal session(s) will be closed. Exit anyway?`
      : 'Exit Agents Commander?';
    const confirmed = await showConfirmDialog(this.screen, this.theme, 'Quit', msg);
    if (confirmed) {
      await this.shutdown();
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
        if (
          this.disposalStarted
          || this.destructiveTransitionInProgress
          || isDialogActive()
          || this.fullScreenOverlayActive
        ) return;
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
        if (
          this.disposalStarted
          || this.destructiveTransitionInProgress
          || isDialogActive()
          || this.fullScreenOverlayActive
        ) return;
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
    screen.key(['C-w'], guard(() => this.actionRemovePanel()));

    // Ctrl+K - Kill agent on active terminal panel
    screen.key(['C-k'], guard(async () => {
      const tp = this.layout.activeTerminalPanel;
      const hasManagedAgent = tp ? this.agentManager.hasAgent(tp.panelIndex) : false;
      if (tp && (tp.isRunning || hasManagedAgent)) {
        const confirmed = await showConfirmDialog(
          screen, this.theme, 'Kill Session',
          'Terminate the running session?',
        );
        if (confirmed) {
          await this.stopTerminalSession(tp.panelIndex);
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

    // F12 - live routed-message activity (works from terminal panels).
    screen.key(['f11'], guard(() => this.actionNavigatePanel()));
    screen.key(['f12'], guard(() => this.actionActivity()));

    // Shift+F12 - protocol guide (F12 itself is reserved for Activity).
    screen.key(['S-f12'], guard(() => showProtocolGuide(screen, this.theme)));

    // Programmed keyboard shortcuts remain an explicit compatibility mode.
    // Shipping devices are handled through the isolated native bridge.
    if (
      this.config?.hardware?.codexMicro.enabled
      && this.config.hardware.codexMicro.inputMode === 'keyboard'
    ) {
      for (const binding of CODEX_MICRO_BINDINGS) {
        const runAction = guard(() => this.runCodexMicroAction(binding.action));
        screen.key([binding.key], () => {
          if (this.codexMicroTestDialog?.isOpen()) {
            this.codexMicroTestDialog.recordAction(binding.action);
            return;
          }
          runAction();
        });
      }
    }

    // Ctrl+O - Orchestrate; in offline-demo mode it also provides a safe
    // retry/replay path when neither bundled role is running.
    screen.key(['C-o'], guard(() => this.actionOrchestrateOrDemo()));

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
        const injected = await this.orchestrator.injectProtocol(tp);
        if (!injected) {
          showErrorToast(screen, 'Protocol injection stopped because the agent session changed');
          return;
        }
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
    screen.key(['C-t'], guard(() => this.runDestructiveTransition(async () => {
      const idx = this.layout.activePanel.panelIndex;
      if (this.layout.isTerminalPanel(idx)) {
        const targetPanel = this.layout.getPanel(idx);
        if (!targetPanel) return;
        const tp = this.layout.getTerminalPanel(idx);
        const hasManagedAgent = this.agentManager.hasAgent(idx);
        if (tp?.isRunning || hasManagedAgent) {
          const confirmed = await showConfirmDialog(
            screen, this.theme, 'Close Terminal',
            'A session is running. Kill it and switch back to a file panel?',
          );
          if (!confirmed) return;
          if (this.layout.getPanel(idx) !== targetPanel) return;
          await this.stopTerminalSession(idx);
          if (this.layout.getPanel(idx) !== targetPanel) return;
        }
        this.orchestrator.disconnectPanel(idx);
        await this.layout.convertToFile(idx);
      } else {
        this.layout.convertToTerminal(idx);
      }
      this.updateStatus();
      screen.render();
    })));

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

    // Shift+F4 is a portable density cycle. Ctrl+number aliases are retained
    // for terminals that can emit them distinctly.
    screen.key(['S-f4'], guard(() => this.actionCyclePanelDensity()));
    screen.key(['C-0'], guard(() => this.actionChangeLayout('auto')));
    screen.key(['C-2'], guard(() => this.actionChangeLayout(2)));
    screen.key(['C-3'], guard(() => this.actionChangeLayout(3)));
    screen.key(['C-4'], guard(() => this.actionChangeLayout(4)));

    // Ctrl+E - Reset to default 2-panel file view (kills all agents)
    // termGuard: vim scroll-down uses C-e
    screen.key(['C-e'], termGuard(() => this.actionResetView()));

  }

  private conferenceStatus(): { modeLabel?: string; warning?: string } {
    const microEnabled = this.config?.hardware?.codexMicro.enabled === true;
    let microLabel = '';
    if (microEnabled) {
      if (this.config.hardware.codexMicro.inputMode === 'keyboard') {
        microLabel = 'MICRO:KEYS/NO-GUARD';
      } else if (!this.codexMicroStatus) {
        microLabel = 'MICRO';
      } else if (
        this.codexMicroStatus.state === 'connected'
        && this.codexMicroStatus.ownership === 'guarded'
      ) {
        microLabel = this.codexMicroStatus.transport === 'usb'
          ? 'MICRO:USB/GUARD'
          : this.codexMicroStatus.transport === 'bluetooth'
            ? 'MICRO:BT/GUARD'
            : 'MICRO:GUARD';
      } else if (this.codexMicroStatus.state === 'busy') {
        microLabel = 'MICRO:BUSY';
      } else if (this.codexMicroStatus.state === 'starting') {
        microLabel = 'MICRO:WAIT';
      } else if (this.codexMicroStatus.state === 'disconnected') {
        microLabel = 'MICRO:LOST';
      } else {
        microLabel = 'MICRO:!';
      }
    }
    if (!this.launch.conference) {
      return microLabel ? { modeLabel: microLabel } : {};
    }
    const columns = typeof this.screen.width === 'number' ? this.screen.width : 80;
    const rows = typeof this.screen.height === 'number' ? this.screen.height : 24;
    const warning = columns < RECOMMENDED_CONFERENCE_COLUMNS || rows < RECOMMENDED_CONFERENCE_ROWS
      ? `screen ${columns}x${rows}; use ${RECOMMENDED_CONFERENCE_COLUMNS}x${RECOMMENDED_CONFERENCE_ROWS}+`
      : undefined;
    return {
      modeLabel: [this.launch.demo ? 'OFFLINE DEMO' : 'CONFERENCE', microLabel]
        .filter(Boolean)
        .join(' + '),
      warning,
    };
  }

  private updateStatus(): void {
    const panel = this.layout.activePanel;
    const launchStatus = this.conferenceStatus();
    const workspaceStatus = {
      panelNumber: panel.panelIndex + 1,
      panelCount: this.layout.panelCount,
      pageNumber: this.layout.viewport.pageNumber,
      pageCount: this.layout.viewport.pageCount,
      density: this.layout.density,
    };

    if (panel instanceof FilePanel) {
      const entry = panel.currentEntry;
      updateStatusBar(this.statusBar, {
        ...launchStatus,
        ...workspaceStatus,
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
        ...launchStatus,
        ...workspaceStatus,
        fileName: info ? `${info.name} [${info.status}]` : panel.sessionName ? `${panel.sessionName} [${panel.status}]` : 'Terminal',
        dirPath: this.workingDir,
      });
    } else {
      updateStatusBar(this.statusBar, { ...launchStatus, ...workspaceStatus });
    }

    this.screen.render();
  }

  private async openEditor(filePath: string): Promise<void> {
    if (this.fullScreenOverlayActive) return;
    this.fullScreenOverlayActive = true;
    let released = false;
    const releaseOverlay = () => {
      if (released) return;
      released = true;
      queueMicrotask(() => {
        this.fullScreenOverlayActive = false;
        if (this.disposalStarted) return;
        void this.layout.refreshAll();
        this.layout.activePanel.setFocus(true);
      });
    };

    try {
      const editor = new MarkdownEditor(
        this.screen,
        this.theme,
        filePath,
        releaseOverlay,
        this.config.editor,
      );
      await editor.open();
    } catch (err) {
      releaseOverlay();
      throw err;
    }
  }

  /**
   * Release every resource owned by this App instance without terminating the
   * host process. Safe to call after partial startup and safe to call again.
   */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposalStarted = true;

    let resolveDispose!: () => void;
    let rejectDispose!: (reason: unknown) => void;
    this.disposePromise = new Promise<void>((resolve, reject) => {
      resolveDispose = resolve;
      rejectDispose = reject;
    });

    const performDispose = async (): Promise<void> => {
      const failures: unknown[] = [];
      const pendingDecision = this.pendingCodexMicroDecision;
      this.pendingCodexMicroDecision = null;
      if (pendingDecision?.timeout) clearTimeout(pendingDecision.timeout);
      pendingDecision?.controller?.cancel();
      try {
        if (this.screen) closeDialogsForScreen(this.screen);
      } catch (error) {
        failures.push(error);
        logger.error('Failed to close active dialogs during disposal', error);
      }
      try {
        this.unsubscribeAgentLifecycle?.();
      } catch (error) {
        failures.push(error);
        logger.error('Failed to unsubscribe application lifecycle listener', error);
      }
      this.unsubscribeAgentLifecycle = null;
      try {
        this.unsubscribeCodexMicroStatus?.();
        this.unsubscribeCodexMicroInput?.();
        await this.codexMicroBridge?.stop();
      } catch (error) {
        failures.push(error);
        logger.error('Failed to stop Codex Micro input bridge', error);
      }
      this.unsubscribeCodexMicroStatus = null;
      this.unsubscribeCodexMicroInput = null;
      this.codexMicroBridge = null;
      this.demoStarted = false;
      this.demoPanelRoles.clear();
      if (this.activityDialog) {
        try {
          this.activityDialog.close();
        } catch (error) {
          failures.push(error);
          logger.error('Failed to close routed-message activity during disposal', error);
        }
        this.activityDialog = null;
      }
      if (this.codexMicroTestDialog) {
        try {
          this.codexMicroTestDialog.close();
        } catch (error) {
          failures.push(error);
          logger.error('Failed to close Codex Micro test dialog during disposal', error);
        }
        this.codexMicroTestDialog = null;
      }

      let managedPanels: TerminalPanel[] = [];
      try {
        managedPanels = this.agentManager.prepareForShutdown();
      } catch (error) {
        failures.push(error);
        logger.error('Failed to stop agent lifecycle management', error);
      }

      const terminalPanels = new Set<TerminalPanel>([
        ...managedPanels,
        ...(this.layout?.terminalPanels ?? []),
      ]);
      const terminalShutdowns: Array<Promise<void>> = [];
      for (const panel of terminalPanels) {
        try {
          // Invoke synchronously so every known panel is launch-sealed before
          // disposal reaches its first await.
          terminalShutdowns.push(panel.shutdownAgent());
        } catch (error) {
          failures.push(error);
          logger.error('Failed to begin terminal shutdown', error);
        }
      }
      const terminalResults = await Promise.allSettled(terminalShutdowns);
      for (const result of terminalResults) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
      if (terminalResults.some((result) => result.status === 'rejected')) {
        logger.error('Failed to stop every terminal session during disposal');
      }
      await TerminalPanel.waitForPendingTerminations();

      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
      }
      if (this.fileChangedHandler) {
        appEvents.removeListener('file:changed', this.fileChangedHandler);
        this.fileChangedHandler = null;
      }

      if (this.watcherStarted) {
        try {
          stopWatching();
        } catch (error) {
          failures.push(error);
          logger.error('Failed to stop the file watcher', error);
        }
        this.watcherStarted = false;
      }

      try {
        this.screen?.destroy();
      } catch (error) {
        failures.push(error);
        logger.error('Failed to restore the terminal during disposal', error);
      }

      const onShutdown = this.onShutdown;
      this.onShutdown = undefined;
      if (onShutdown) {
        try {
          await onShutdown();
        } catch (error) {
          failures.push(error);
          logger.error('Launch cleanup failed during disposal', error);
        }
      }

      this.removeProcessHandlers();
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Agents Commander disposal was incomplete');
      }
    };
    void performDispose().then(resolveDispose, rejectDispose);

    return this.disposePromise;
  }

  private shutdown(exitCode = 0): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shutdownPromise = (async () => {
      let finalExitCode = exitCode;
      try {
        await this.dispose();
      } catch (error) {
        finalExitCode = finalExitCode || 1;
        logger.error('Agents Commander shutdown was incomplete', error);
      }

      logger.info('Agents Commander shutting down', { exitCode: finalExitCode });
      logger.close();
      process.exit(finalExitCode);
    })();

    return this.shutdownPromise;
  }
}
