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
vi.mock('../../src/screen/dialog/panel-navigator-dialog.js', () => ({
  showPanelNavigatorDialog: vi.fn(),
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
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { copyFiles, createDirectory, moveFile } from '../../src/file-manager/file-operations.js';
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { showInputDialog } from '../../src/screen/dialog/input-dialog.js';
import { showAgentDialog } from '../../src/screen/dialog/agent-dialog.js';
import { showTemplateDialog } from '../../src/screen/dialog/template-dialog.js';
import { showOrchestrateDialog } from '../../src/screen/dialog/orchestrate-dialog.js';
import { showPanelNavigatorDialog } from '../../src/screen/dialog/panel-navigator-dialog.js';
import { showErrorToast } from '../../src/screen/toast.js';

function createHarness(options: {
  mode?: 'auto' | 2 | 3 | 4;
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
  const allPanels = [activePanel, { panelIndex: 1 }, { panelIndex: 2 }];
  const layout = {
    mode: options.mode ?? 2,
    density: options.mode ?? 2,
    panelCount: 3,
    workspacePanelIds: [0, 1, 2],
    viewport: { pageNumber: 1, pageCount: 1 },
    terminalPanels: livePanels,
    allPanels,
    activePanel,
    activePanelId: activePanel.panelIndex,
    addPanel: vi.fn(async () => true),
    setMode: vi.fn(async () => undefined),
    resetToDefault: vi.fn(async () => undefined),
    getTerminalPanel: vi.fn((panelIndex: number) => (
      livePanels.find((panel) => panel.panelIndex === panelIndex) ?? null
    )),
    getPanel: vi.fn((panelIndex: number) => (
      allPanels.find((panel) => panel.panelIndex === panelIndex) ?? null
    )),
    convertToTerminal: vi.fn((panelIndex: number) => (
      livePanels.find((panel) => panel.panelIndex === panelIndex) ?? null
    )),
    hasPanel: vi.fn((panelIndex: number) => [0, 1, 2].includes(panelIndex)),
    setActivePanel: vi.fn(),
    removePanel: vi.fn(() => true),
  };
  const agentManager = {
    killAll: vi.fn(),
    hasAgent: vi.fn(() => options.managed ?? false),
    killAgent: vi.fn(),
    launchAgent: vi.fn(() => true),
    launchProfile: vi.fn(() => true),
    prepareForShutdown: vi.fn(() => []),
    handlePanelRemoval: vi.fn(),
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
    handlePanelRemoval: vi.fn(),
    reindexAfterPanelRemoval: vi.fn(),
    sendTask: vi.fn(async () => ({ success: true })),
  };
  const app: any = Object.create(App.prototype);
  Object.assign(app, {
    layout,
    agentManager,
    orchestrator,
    screen: { destroy: vi.fn(), render: vi.fn(), key: vi.fn() },
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
    workingDir: '/workspace',
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
    expect(agentManager.launchProfile).not.toHaveBeenCalled();
  });

  it('does not overwrite a replacement session that starts while termination is pending', async () => {
    let releaseTermination!: () => void;
    const termination = new Promise<void>((resolve) => { releaseTermination = resolve; });
    vi.mocked(showAgentDialog).mockResolvedValue({
      agentType: 'codex',
      panelIndex: 0,
    });
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    const { app, agentManager, activePanel } = createHarness({
      managed: true,
      livePanels: [{ panelIndex: 0, sessionName: 'Old Agent', isRunning: true }],
    });
    agentManager.killAgent.mockImplementation(() => {
      activePanel.isRunning = false;
      return termination;
    });

    const launch = app.actionLaunchAgent();
    await vi.waitFor(() => expect(agentManager.killAgent).toHaveBeenCalledWith(0));
    activePanel.isRunning = true;
    activePanel.sessionName = 'Replacement Agent';
    releaseTermination();
    await launch;

    expect(agentManager.launchProfile).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      expect.stringContaining('started another session'),
    );
  });

  it('passes ordered sparse stable IDs to every target-panel dialog', async () => {
    vi.mocked(showAgentDialog).mockResolvedValue(null);
    vi.mocked(showTemplateDialog).mockResolvedValue(null);
    vi.mocked(showOrchestrateDialog).mockResolvedValue(null);
    const { app, layout } = createHarness();
    layout.workspacePanelIds = [0, 2, 9, 99];
    layout.activePanel = { panelIndex: 99, sessionName: null, isRunning: false };

    await app.actionLaunchAgent();
    await app.actionBrowseTemplates();
    await app.actionOrchestrate();

    expect(showAgentDialog).toHaveBeenCalledWith(
      app.screen,
      app.theme,
      [0, 2, 9, 99],
      99,
      app.config.agents,
      app.config.agentProfiles,
    );
    expect(showTemplateDialog).toHaveBeenCalledWith(
      app.screen,
      app.theme,
      [0, 2, 9, 99],
      99,
    );
    expect(showOrchestrateDialog).toHaveBeenCalledWith(
      app.screen,
      app.theme,
      [0, 2, 9, 99],
      99,
      app.config.agents,
      app.config.agentProfiles,
    );
  });

  it('navigates to the stable panel ID selected through F11 search', async () => {
    vi.mocked(showPanelNavigatorDialog).mockResolvedValue(2);
    const { app, layout } = createHarness();
    layout.workspacePanelIds = [0, 2, 99];
    layout.allPanels = [0, 2, 99].map((panelIndex) => Object.assign(
      Object.create(TerminalPanel.prototype),
      {
        panelIndex,
        agentName: '',
        _status: 'idle',
        cwd: `/workspace/panel-${panelIndex + 1}`,
      },
    ));
    layout.hasPanel.mockImplementation((panelIndex: number) => (
      [0, 2, 99].includes(panelIndex)
    ));

    await app.actionNavigatePanel();

    expect(showPanelNavigatorDialog).toHaveBeenCalledWith(
      app.screen,
      app.theme,
      expect.arrayContaining([
        expect.objectContaining({ panelId: 0, panelNumber: 1 }),
        expect.objectContaining({ panelId: 2, panelNumber: 3 }),
        expect.objectContaining({ panelId: 99, panelNumber: 100 }),
      ]),
      0,
    );
    expect(layout.setActivePanel).toHaveBeenCalledWith(2);
    expect(app.updateStatus).toHaveBeenCalledOnce();
  });

  it('changes density without prompting, stopping, or rerouting live sessions', async () => {
    const { app, layout, agentManager, orchestrator } = createHarness({
      livePanels: [{ panelIndex: 0, sessionName: 'Claude', isRunning: true }],
    });

    await app.actionChangeLayout(3);

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(agentManager.killAll).not.toHaveBeenCalled();
    expect(orchestrator.resetState).not.toHaveBeenCalled();
    expect(layout.setMode).toHaveBeenCalledWith(3);
  });

  it('changes density exactly once while preserving running agents', async () => {
    const { app, layout, agentManager, orchestrator } = createHarness({
      livePanels: [{ panelIndex: 0, sessionName: 'Claude', isRunning: true }],
    });

    await app.actionChangeLayout(4);

    expect(agentManager.killAll).not.toHaveBeenCalled();
    expect(orchestrator.resetState).not.toHaveBeenCalled();
    expect(layout.setMode).toHaveBeenCalledOnce();
    expect(layout.setMode).toHaveBeenCalledWith(4);
  });

  it('cycles density through a portable Shift+F4 action', async () => {
    const { app, layout } = createHarness({ mode: 'auto' });

    await app.actionCyclePanelDensity();

    expect(layout.setMode).toHaveBeenCalledWith(2);
  });

  it('keeps an unmanaged terminal alive while changing density', async () => {
    const terminal = {
      panelIndex: 0,
      sessionName: 'Vim',
      isRunning: true,
      killAgent: vi.fn(),
    };
    const { app, layout } = createHarness({ livePanels: [terminal] });

    await app.actionChangeLayout(4);

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(terminal.killAgent).not.toHaveBeenCalled();
    expect(layout.setMode).toHaveBeenCalledWith(4);
  });

  it('does not prompt when changing layout without live sessions', async () => {
    const { app, layout } = createHarness();

    await app.actionChangeLayout(3);

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(layout.setMode).toHaveBeenCalledWith(3);
  });

  it('collapses repeated density requests while one reflow is in flight', async () => {
    let releaseReflow!: () => void;
    const reflow = new Promise<void>((resolve) => { releaseReflow = resolve; });
    const { app, layout } = createHarness({
      livePanels: [{ panelIndex: 0, sessionName: 'shell', isRunning: true }],
    });
    layout.setMode.mockReturnValue(reflow);

    const first = app.actionChangeLayout(3);
    const second = app.actionChangeLayout(4);
    releaseReflow();
    await Promise.all([first, second]);

    expect(showConfirmDialog).not.toHaveBeenCalled();
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

  it('preserves a managed agent waiting to restart across density changes', async () => {
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

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(agentManager.killAll).not.toHaveBeenCalled();
    expect(layout.setMode).toHaveBeenCalledWith(3);
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

  it('renames one selected item inside the active panel instead of a hidden panel', async () => {
    vi.mocked(showInputDialog).mockResolvedValue('renamed.md');
    const { app, layout } = createHarness();
    Object.assign(layout, {
      activeFilePanel: {
        currentPath: '/active',
        selectedEntries: [{
          name: 'notes.md',
          fullPath: '/active/notes.md',
          isDirectory: false,
        }],
      },
      inactiveFilePanel: { currentPath: '/hidden-unrelated' },
      refreshAll: vi.fn(),
    });

    await app.actionMove();

    expect(moveFile).toHaveBeenCalledWith('/active/notes.md', '/active/renamed.md');
    expect(moveFile).not.toHaveBeenCalledWith(
      '/active/notes.md',
      '/hidden-unrelated/renamed.md',
    );
  });

  it('blocks global mutations while a destructive transition is in progress', () => {
    const { app, layout } = createHarness();
    app.destructiveTransitionInProgress = true;
    app.setupGlobalKeys();
    const f3Registration = vi.mocked(app.screen.key).mock.calls.find(
      (call) => (call[0] as string[]).includes('f3'),
    );

    expect(f3Registration).toBeDefined();
    f3Registration![1]();
    expect(layout.addPanel).not.toHaveBeenCalled();
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
