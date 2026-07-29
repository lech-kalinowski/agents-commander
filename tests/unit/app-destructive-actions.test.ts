import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/screen/dialog/confirm-dialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));
vi.mock('../../src/screen/dialog/input-dialog.js', () => ({
  showInputDialog: vi.fn(),
}));
vi.mock('../../src/screen/dialog/agent-dialog.js', () => ({
  showAgentDialog: vi.fn(),
}));
vi.mock('../../src/screen/dialog/template-dialog.js', () => ({
  showTemplateDialog: vi.fn(),
}));
vi.mock('../../src/screen/dialog/orchestrate-dialog.js', () => ({
  showOrchestrateDialog: vi.fn(),
}));
vi.mock('../../src/screen/toast.js', () => ({
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));
vi.mock('../../src/file-manager/file-operations.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/file-manager/file-operations.js')>(),
  copyFiles: vi.fn(),
  moveFile: vi.fn(),
  moveFiles: vi.fn(),
  deleteFiles: vi.fn(),
  createDirectory: vi.fn(),
}));

import { App } from '../../src/app.js';
import { copyFiles, createDirectory } from '../../src/file-manager/file-operations.js';
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { showInputDialog } from '../../src/screen/dialog/input-dialog.js';
import { showAgentDialog } from '../../src/screen/dialog/agent-dialog.js';
import { showTemplateDialog } from '../../src/screen/dialog/template-dialog.js';
import { showOrchestrateDialog } from '../../src/screen/dialog/orchestrate-dialog.js';
import { showErrorToast } from '../../src/screen/toast.js';

function createHarness(options: {
  mode?: 2 | 3 | 4;
  livePanels?: Array<{ panelIndex: number; sessionName: string | null; isRunning: boolean }>;
  managed?: boolean;
  managedSessions?: Array<{
    panelIndex: number;
    type: 'claude' | 'codex';
    name: string;
    status: string;
  }>;
} = {}) {
  const livePanels = (options.livePanels ?? []).map((panel) => ({
    killAgent: vi.fn(async () => undefined),
    ...panel,
  }));
  const managedSessions = (options.managedSessions ?? []).map((session) => ({
    ...session,
    sessionId: `${session.type}-${session.panelIndex}`,
    uptime: 1,
  }));
  const activePanel = livePanels[0] ?? { panelIndex: 0, sessionName: null, isRunning: false };
  const layout = {
    mode: options.mode ?? 2,
    panelCount: 3,
    terminalPanels: livePanels,
    allPanels: [activePanel, {}, {}],
    activePanel,
    setMode: vi.fn(async () => undefined),
    resetToDefault: vi.fn(async () => undefined),
    getTerminalPanel: vi.fn((panelIndex: number) => (
      livePanels.find((panel) => panel.panelIndex === panelIndex) ?? null
    )),
    removePanel: vi.fn(() => true),
  };
  const agentManager = {
    killAll: vi.fn(),
    hasAgent: vi.fn(() => options.managed ?? false),
    killAgent: vi.fn(),
    launchAgent: vi.fn(() => true),
    prepareForShutdown: vi.fn(() => []),
    reindexAfterPanelRemoval: vi.fn(),
    getRunningAgents: vi.fn(() => managedSessions),
    getAgentType: vi.fn((panelIndex: number) => (
      managedSessions.find((session) => session.panelIndex === panelIndex)?.type ?? null
    )),
    isAgentRunning: vi.fn((panelIndex: number) => (
      managedSessions.some((session) => session.panelIndex === panelIndex)
    )),
  };
  const orchestrator = {
    resetState: vi.fn(),
    disconnectPanel: vi.fn(),
    reindexAfterPanelRemoval: vi.fn(),
    sendTask: vi.fn(async () => ({ success: true })),
  };
  const app: any = Object.create(App.prototype);
  Object.assign(app, {
    layout,
    agentManager,
    orchestrator,
    screen: { destroy: vi.fn(), render: vi.fn() },
    theme: {},
    config: { agents: {} },
    destructiveTransitionInProgress: false,
    fullScreenOverlayActive: false,
    disposalStarted: false,
    disposePromise: null,
    demoStarted: false,
    demoPanelRoles: new Map(),
    demoRollbackPromise: null,
    activityDialog: null,
    unsubscribeAgentLifecycle: null,
    processHandlersInstalled: false,
    watcherStarted: false,
    updateStatus: vi.fn(),
  });
  return { app, layout, agentManager, orchestrator, activePanel };
}

describe('App destructive layout actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing for a same-mode request, even with live sessions', async () => {
    const { app, layout, agentManager, orchestrator } = createHarness({
      mode: 2,
      livePanels: [{ panelIndex: 0, sessionName: 'shell', isRunning: true }],
    });

    await app.actionChangeLayout(2);

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(agentManager.killAll).not.toHaveBeenCalled();
    expect(orchestrator.resetState).not.toHaveBeenCalled();
    expect(layout.setMode).not.toHaveBeenCalled();
  });

  it('does not launch from an in-flight agent dialog after disposal begins', async () => {
    let resolveDialog!: (value: {
      agentType: 'codex';
      panelIndex: number;
    }) => void;
    vi.mocked(showAgentDialog).mockReturnValue(new Promise((resolve) => {
      resolveDialog = resolve;
    }));
    const { app, agentManager } = createHarness();

    const action = app.actionLaunchAgent();
    await Promise.resolve();
    const disposal = app.dispose();
    expect(app.disposalStarted).toBe(true);
    resolveDialog({ agentType: 'codex', panelIndex: 0 });

    await Promise.all([action, disposal]);
    expect(agentManager.launchAgent).not.toHaveBeenCalled();
  });

  it('preserves all state when a live-session layout change is canceled', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const { app, layout, agentManager, orchestrator } = createHarness({
      livePanels: [{ panelIndex: 0, sessionName: 'Claude', isRunning: true }],
    });

    await app.actionChangeLayout(3);

    expect(agentManager.killAll).not.toHaveBeenCalled();
    expect(orchestrator.resetState).not.toHaveBeenCalled();
    expect(layout.setMode).not.toHaveBeenCalled();
  });

  it('changes layout exactly once after confirmation', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    const { app, layout, agentManager, orchestrator } = createHarness({
      livePanels: [{ panelIndex: 0, sessionName: 'Claude', isRunning: true }],
    });

    await app.actionChangeLayout(4);

    expect(agentManager.killAll).toHaveBeenCalledOnce();
    expect(orchestrator.resetState).toHaveBeenCalledOnce();
    expect(layout.setMode).toHaveBeenCalledOnce();
    expect(layout.setMode).toHaveBeenCalledWith(4);
  });

  it('waits for an unmanaged terminal to close before replacing the layout', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    let releaseTermination!: () => void;
    const termination = new Promise<void>((resolve) => {
      releaseTermination = resolve;
    });
    const terminal = {
      panelIndex: 0,
      sessionName: 'Vim',
      isRunning: true,
      killAgent: vi.fn(() => termination),
    };
    const { app, layout } = createHarness({ livePanels: [terminal] });

    const change = app.actionChangeLayout(4);
    await vi.waitFor(() => {
      expect(terminal.killAgent).toHaveBeenCalledWith(true);
    });
    expect(layout.setMode).not.toHaveBeenCalled();

    releaseTermination();
    await change;
    expect(layout.setMode).toHaveBeenCalledWith(4);
  });

  it('does not prompt when changing layout without live sessions', async () => {
    const { app, layout } = createHarness();

    await app.actionChangeLayout(3);

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(layout.setMode).toHaveBeenCalledWith(3);
  });

  it('collapses repeated destructive shortcut requests', async () => {
    let resolveConfirmation!: (value: boolean) => void;
    vi.mocked(showConfirmDialog).mockReturnValue(
      new Promise<boolean>((resolve) => { resolveConfirmation = resolve; }),
    );
    const { app, layout } = createHarness({
      livePanels: [{ panelIndex: 0, sessionName: 'shell', isRunning: true }],
    });

    const first = app.actionChangeLayout(3);
    const second = app.actionChangeLayout(4);
    resolveConfirmation(true);
    await Promise.all([first, second]);

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(layout.setMode).toHaveBeenCalledOnce();
    expect(layout.setMode).toHaveBeenCalledWith(3);
  });

  it('prompts before removing an unmanaged live terminal panel', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    const terminal = {
      panelIndex: 0,
      sessionName: 'Vim',
      isRunning: true,
      killAgent: vi.fn(),
    };
    const { app, layout, orchestrator } = createHarness({ livePanels: [terminal] });

    await app.actionRemovePanel();

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(terminal.killAgent).toHaveBeenCalledWith(true);
    expect(orchestrator.disconnectPanel).toHaveBeenCalledWith(0);
    expect(layout.removePanel).toHaveBeenCalledOnce();
  });

  it('detects unmanaged terminal sessions before resetting the view', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const { app, layout, agentManager } = createHarness({
      livePanels: [{ panelIndex: 1, sessionName: 'shell', isRunning: true }],
    });

    await app.actionResetView();

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(agentManager.killAll).not.toHaveBeenCalled();
    expect(layout.resetToDefault).not.toHaveBeenCalled();
  });

  it('treats a managed agent waiting to restart as a live session', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const { app, layout, agentManager } = createHarness({
      livePanels: [{ panelIndex: 1, sessionName: 'Codex', isRunning: false }],
      managedSessions: [{
        panelIndex: 1,
        type: 'codex',
        name: 'Codex',
        status: 'restarting',
      }],
    });

    await app.actionChangeLayout(3);

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(agentManager.killAll).not.toHaveBeenCalled();
    expect(layout.setMode).not.toHaveBeenCalled();
  });

  it('does not deliver an orchestrated task when replacing a session is declined', async () => {
    vi.mocked(showOrchestrateDialog).mockResolvedValue({
      agentType: 'codex',
      panelIndex: 1,
      task: 'Review the patch',
    });
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const { app, orchestrator } = createHarness({
      livePanels: [{ panelIndex: 1, sessionName: 'shell', isRunning: true }],
    });

    await app.actionOrchestrate();

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(orchestrator.sendTask).not.toHaveBeenCalled();
  });

  it('does not replace a mismatched managed agent selected by the template picker', async () => {
    vi.mocked(showTemplateDialog).mockResolvedValue({
      content: 'Use the collaboration template',
      panelIndex: 0,
      templateName: 'Conference Review',
    });
    vi.mocked(showAgentDialog).mockResolvedValue({
      agentType: 'codex',
      panelIndex: 1,
    });
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const { app, orchestrator } = createHarness({
      livePanels: [{ panelIndex: 1, sessionName: 'Claude', isRunning: true }],
      managedSessions: [{
        panelIndex: 1,
        type: 'claude',
        name: 'Claude',
        status: 'running',
      }],
    });

    await app.actionBrowseTemplates();

    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(orchestrator.sendTask).not.toHaveBeenCalled();
  });

  it('warns that an unmanaged terminal session will close on quit', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const { app } = createHarness({
      livePanels: [{ panelIndex: 0, sessionName: 'Vim', isRunning: true }],
    });

    await app.actionQuit();

    expect(showConfirmDialog).toHaveBeenCalledWith(
      app.screen,
      app.theme,
      'Quit',
      '1 live terminal session(s) will be closed. Exit anyway?',
    );
  });

  it('surfaces file-operation failures to the user as well as the log', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    vi.mocked(copyFiles).mockRejectedValue(
      Object.assign(new Error('private path'), { code: 'EACCES' }),
    );
    const { app, layout } = createHarness();
    Object.assign(layout, {
      activeFilePanel: {
        selectedEntries: [{
          name: 'notes.md',
          fullPath: '/source/notes.md',
          isDirectory: false,
        }],
      },
      inactiveFilePanel: { currentPath: '/target' },
      refreshAll: vi.fn(),
    });

    await app.actionCopy();

    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      expect.stringContaining('permission denied'),
    );
    expect(layout.refreshAll).not.toHaveBeenCalled();
  });

  it('rejects unsafe directory names before touching the filesystem', async () => {
    vi.mocked(showInputDialog).mockResolvedValue('../outside');
    const { app, layout } = createHarness();
    Object.assign(layout, {
      activeFilePanel: {
        currentPath: '/project',
        loadDirectory: vi.fn(),
      },
    });

    await app.actionMkdir();

    expect(createDirectory).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      expect.stringContaining('path separators are not allowed'),
    );
  });
});
