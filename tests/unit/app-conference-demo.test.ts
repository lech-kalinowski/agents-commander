import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/file-manager/file-watcher.js', () => ({
  startWatching: vi.fn(),
  stopWatching: vi.fn(),
}));
vi.mock('../../src/screen/toast.js', () => ({
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  },
}));

import { App } from '../../src/app.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { showErrorToast, showToast } from '../../src/screen/toast.js';
import { logger } from '../../src/utils/logger.js';

function createDemoHarness() {
  let capabilitySequence = 0;
  const terminals = [
    { panelIndex: 0, sendInput: vi.fn(() => true), isRunning: false },
    { panelIndex: 1, sendInput: vi.fn(() => true), isRunning: false },
  ];
  const app: any = Object.create(App.prototype);
  Object.assign(app, {
    launch: { conference: true, demo: true, skipWelcome: true },
    disposalStarted: false,
    demoStarted: false,
    demoPanelRoles: new Map(),
    demoRollbackPromise: null,
    layout: {
      panelCount: 2,
      workspacePanelIds: [0, 1],
      addPanel: vi.fn(async () => true),
      hasPanel: vi.fn((panelId: number) => [0, 1].includes(panelId)),
      getTerminalPanel: vi.fn(() => null),
      convertToTerminal: vi.fn((index: number) => terminals[index]),
      setActivePanel: vi.fn(),
    },
    agentManager: {
      launchInternalAgent: vi.fn(() => true),
    },
    orchestrator: {
      connectPanel: vi.fn(),
      createProtocolCapability: vi.fn(() => (
        `${'a'.repeat(42)}${++capabilitySequence}`
      )),
      armInternalProtocol: vi.fn(() => true),
      sendProgrammaticInput: vi.fn(async (
        terminal: { sendInput(text: string): boolean },
        text: string,
        submit = false,
      ) => (
        terminal.sendInput(`${text}${submit ? '\r' : ''}`)
      )),
    },
    screen: {
      render: vi.fn(),
    },
    hasLiveTerminalSession: vi.fn(() => false),
    stopTerminalSession: vi.fn(async () => undefined),
    updateStatus: vi.fn(),
  });
  return { app, terminals };
}

describe('App conference and offline demo integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers both managed demo roles before sending the explicit START token', async () => {
    const { app, terminals } = createDemoHarness();

    const started = app.startOfflineDemo();
    await vi.advanceTimersByTimeAsync(150);
    await started;

    expect(app.agentManager.launchInternalAgent).toHaveBeenCalledTimes(2);
    expect(app.orchestrator.connectPanel).toHaveBeenNthCalledWith(1, terminals[0]);
    expect(app.orchestrator.connectPanel).toHaveBeenNthCalledWith(2, terminals[1]);
    expect(terminals[0].sendInput).toHaveBeenCalledWith('START\r');
    expect(terminals[1].sendInput).not.toHaveBeenCalled();
    expect(app.layout.setActivePanel).toHaveBeenCalledWith(0);
    expect(showToast).toHaveBeenCalledWith(
      app.screen,
      expect.stringContaining('press F12'),
    );
  });

  it('launches demo roles on the first two surviving stable panel IDs', async () => {
    const { app, terminals } = createDemoHarness();
    terminals[0].panelIndex = 4;
    terminals[1].panelIndex = 9;
    app.layout.workspacePanelIds = [4, 9];
    app.layout.hasPanel.mockImplementation((panelId: number) => [4, 9].includes(panelId));
    app.layout.convertToTerminal.mockImplementation((panelId: number) => (
      panelId === 4 ? terminals[0] : terminals[1]
    ));

    const started = app.startOfflineDemo();
    await vi.advanceTimersByTimeAsync(150);
    await started;

    expect(app.layout.convertToTerminal).toHaveBeenNthCalledWith(1, 4);
    expect(app.layout.convertToTerminal).toHaveBeenNthCalledWith(2, 9);
    expect(app.layout.setActivePanel).toHaveBeenCalledWith(4);
    expect([...app.demoPanelRoles.keys()]).toEqual([4, 9]);
    expect(terminals[0].sendInput).toHaveBeenCalledWith('START\r');
  });

  it('cleans a partial demo launch and permits a later retry', async () => {
    const { app } = createDemoHarness();
    let releaseRollback!: () => void;
    const rollback = new Promise<void>((resolve) => {
      releaseRollback = resolve;
    });
    app.stopTerminalSession.mockReturnValue(rollback);
    app.agentManager.launchInternalAgent
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const started = app.startOfflineDemo();
    const rejected = expect(started).rejects.toThrow('reviewer');
    let settled = false;
    void started.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(app.stopTerminalSession).toHaveBeenCalledWith(0);
    expect(app.demoStarted).toBe(false);
    expect(settled).toBe(false);

    releaseRollback();
    await rejected;
    expect(settled).toBe(true);
  });

  it('does not announce success when the coordinator stdin closes before START', async () => {
    const { app, terminals } = createDemoHarness();
    terminals[0].sendInput.mockReturnValue(false);
    let releaseRollback!: () => void;
    const rollback = new Promise<void>((resolve) => {
      releaseRollback = resolve;
    });
    app.stopTerminalSession.mockReturnValue(rollback);

    const started = app.startOfflineDemo();
    const rejected = expect(started).rejects.toThrow('closed before the START token');
    await vi.advanceTimersByTimeAsync(150);

    expect(showToast).not.toHaveBeenCalled();
    expect(app.stopTerminalSession).toHaveBeenCalledWith(0);
    expect(app.stopTerminalSession).toHaveBeenCalledWith(1);
    expect(app.demoStarted).toBe(false);
    expect(app.demoPanelRoles.size).toBe(0);

    releaseRollback();
    await rejected;
  });

  it('stops the peer and exposes the retry path when a demo role fails', async () => {
    const { app } = createDemoHarness();
    app.demoStarted = true;
    app.demoPanelRoles = new Map([
      [0, 'coordinator'],
      [1, 'reviewer'],
    ]);
    app.offerOfflineDemo = vi.fn(async () => undefined);
    app.actionOrchestrate = vi.fn(async () => undefined);

    app.handleAgentLifecycle({
      type: 'exited',
      panelIndex: 0,
      sessionId: 'generic_1_demo',
      agentType: 'generic',
      agentName: 'Demo Coordinator',
      exitCode: 2,
      signal: null,
      reason: 'process-exit',
    });

    await app.demoRollbackPromise;
    expect(app.stopTerminalSession).toHaveBeenCalledWith(1);
    expect(app.demoStarted).toBe(false);
    expect(app.demoPanelRoles.size).toBe(0);
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      expect.stringMatching(/code 2.*Ctrl\+O to retry/u),
      5000,
    );

    await app.actionOrchestrateOrDemo();
    expect(app.offerOfflineDemo).toHaveBeenCalledOnce();
    expect(app.actionOrchestrate).not.toHaveBeenCalled();
  });

  it('treats a null-code spawn error as a demo failure with retry guidance', async () => {
    const { app } = createDemoHarness();
    app.demoStarted = true;
    app.demoPanelRoles = new Map([
      [0, 'coordinator'],
      [1, 'reviewer'],
    ]);

    app.handleAgentLifecycle({
      type: 'exited',
      panelIndex: 1,
      sessionId: 'generic_2_demo',
      agentType: 'generic',
      agentName: 'Demo Reviewer',
      exitCode: null,
      signal: null,
      reason: 'spawn-error',
    });

    await app.demoRollbackPromise;
    expect(app.stopTerminalSession).toHaveBeenCalledWith(0);
    expect(app.demoStarted).toBe(false);
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      expect.stringMatching(/spawn error.*Ctrl\+O to retry/u),
      5000,
    );
  });

  it('quietly stops the remaining peer after an intentional demo-session stop', async () => {
    const { app } = createDemoHarness();
    app.demoStarted = true;
    app.demoPanelRoles = new Map([
      [0, 'coordinator'],
      [1, 'reviewer'],
    ]);
    app.offerOfflineDemo = vi.fn(async () => undefined);
    app.actionOrchestrate = vi.fn(async () => undefined);

    app.handleAgentLifecycle({
      type: 'exited',
      panelIndex: 0,
      sessionId: 'generic_1_demo',
      agentType: 'generic',
      agentName: 'Demo Coordinator',
      exitCode: null,
      signal: null,
      reason: 'requested',
    });

    await app.demoRollbackPromise;
    expect(app.demoStarted).toBe(false);
    expect(app.stopTerminalSession).toHaveBeenCalledWith(1);
    expect(app.demoPanelRoles.size).toBe(0);
    expect(showErrorToast).not.toHaveBeenCalled();

    await app.actionOrchestrateOrDemo();
    expect(app.offerOfflineDemo).toHaveBeenCalledOnce();
    expect(app.actionOrchestrate).not.toHaveBeenCalled();
  });

  it('uses Ctrl+O orchestration as a retry or replay path when demo roles are stopped', async () => {
    const app: any = Object.create(App.prototype);
    Object.assign(app, {
      launch: { demo: true },
      demoStarted: true,
      demoPanelRoles: new Map(),
      hasLiveTerminalSession: vi.fn(() => false),
      offerOfflineDemo: vi.fn(async () => undefined),
      actionOrchestrate: vi.fn(async () => undefined),
    });

    await app.actionOrchestrateOrDemo();

    expect(app.demoStarted).toBe(false);
    expect(app.offerOfflineDemo).toHaveBeenCalledOnce();
    expect(app.actionOrchestrate).not.toHaveBeenCalled();
  });

  it('keeps Ctrl+O routed to normal orchestration while a demo role is live', async () => {
    const app: any = Object.create(App.prototype);
    Object.assign(app, {
      launch: { demo: true },
      demoStarted: true,
      demoPanelRoles: new Map([[0, 'coordinator']]),
      hasLiveTerminalSession: vi.fn((panelIndex: number) => panelIndex === 0),
      offerOfflineDemo: vi.fn(async () => undefined),
      actionOrchestrate: vi.fn(async () => undefined),
    });

    await app.actionOrchestrateOrDemo();

    expect(app.offerOfflineDemo).not.toHaveBeenCalled();
    expect(app.actionOrchestrate).toHaveBeenCalledOnce();
  });

  it('keeps the conference label visible and reports undersized terminals', () => {
    const app: any = Object.create(App.prototype);
    Object.assign(app, {
      launch: { conference: true, demo: false },
      screen: { width: 82, height: 20 },
    });

    expect(app.conferenceStatus()).toEqual({
      modeLabel: 'CONFERENCE',
      warning: 'screen 82x20; use 100x24+',
    });

    app.launch.demo = true;
    app.screen = { width: 120, height: 30 };
    expect(app.conferenceStatus()).toEqual({
      modeLabel: 'OFFLINE DEMO',
      warning: undefined,
    });

    app.config = {
      hardware: {
        codexMicro: { enabled: true, inputMode: 'native', decisionControls: false },
      },
    };
    app.codexMicroStatus = {
      state: 'connected',
      transport: 'usb',
      connectionEpoch: 'device-epoch',
      ownership: 'guarded',
    };
    expect(app.conferenceStatus()).toEqual({
      modeLabel: 'OFFLINE DEMO + MICRO:USB/GUARD',
      warning: undefined,
    });

    app.launch = { conference: false, demo: false };
    expect(app.conferenceStatus()).toEqual({ modeLabel: 'MICRO:USB/GUARD' });

    delete app.codexMicroStatus.ownership;
    expect(app.conferenceStatus()).toEqual({ modeLabel: 'MICRO:!' });

    app.codexMicroStatus = {
      state: 'disconnected',
      transport: 'unknown',
      connectionEpoch: null,
    };
    expect(app.conferenceStatus()).toEqual({ modeLabel: 'MICRO:LOST' });

    app.config.hardware.codexMicro.inputMode = 'keyboard';
    expect(app.conferenceStatus()).toEqual({ modeLabel: 'MICRO:KEYS/NO-GUARD' });
  });

  it('runs owned launch cleanup exactly once before exiting', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const cleanup = vi.fn(async () => undefined);
    const closeActivity = vi.fn();
    const unsubscribeAgentLifecycle = vi.fn();
    let releaseTerminal!: () => void;
    const terminalStopped = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    const terminal = { shutdownAgent: vi.fn(() => terminalStopped) };
    const app: any = Object.create(App.prototype);
    Object.assign(app, {
      shutdownPromise: null,
      disposePromise: null,
      onShutdown: cleanup,
      activityDialog: { close: closeActivity, refresh: vi.fn() },
      unsubscribeAgentLifecycle,
      processHandlersInstalled: false,
      watcherStarted: false,
      demoStarted: false,
      demoPanelRoles: new Map(),
      agentManager: { prepareForShutdown: vi.fn(() => [terminal]) },
      layout: { terminalPanels: [terminal] },
      screen: { destroy: vi.fn() },
    });

    const first = app.shutdown();
    const second = app.shutdown();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    releaseTerminal();
    await first;

    expect(cleanup).toHaveBeenCalledOnce();
    expect(closeActivity).toHaveBeenCalledOnce();
    expect(app.activityDialog).toBeNull();
    expect(unsubscribeAgentLifecycle).toHaveBeenCalledOnce();
    expect(terminal.shutdownAgent).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('rolls back partial startup before propagating the original failure', async () => {
    const startupError = new Error('watcher failed');
    const app: any = Object.create(App.prototype);
    app.runApplication = vi.fn(async () => {
      throw startupError;
    });
    app.dispose = vi.fn(async () => undefined);

    await expect(app.run()).rejects.toBe(startupError);

    expect(app.dispose).toHaveBeenCalledOnce();
    expect(logger.close).toHaveBeenCalledOnce();
  });

  it('accepts signal ownership only after its termination handlers are installed', () => {
    const previousSigtermListeners = process.listenerCount('SIGTERM');
    let listenersAtTransfer = -1;
    const onSignalOwnership = vi.fn(() => {
      listenersAtTransfer = process.listenerCount('SIGTERM');
    });
    const app: any = new App(process.cwd(), { onSignalOwnership });

    try {
      app.installProcessHandlers();
      app.installProcessHandlers();

      expect(onSignalOwnership).toHaveBeenCalledOnce();
      expect(listenersAtTransfer).toBe(previousSigtermListeners + 1);
    } finally {
      app.removeProcessHandlers();
    }
  });

  it('awaits processes from retired panels before launch cleanup', async () => {
    let releaseRetiredPanel!: () => void;
    const retiredPanelStopped = new Promise<void>((resolve) => {
      releaseRetiredPanel = resolve;
    });
    vi.spyOn(TerminalPanel, 'waitForPendingTerminations')
      .mockReturnValue(retiredPanelStopped);
    const cleanup = vi.fn(async () => undefined);
    const app: any = Object.create(App.prototype);
    Object.assign(app, {
      disposePromise: null,
      onShutdown: cleanup,
      processHandlersInstalled: false,
      watcherStarted: false,
      unsubscribeAgentLifecycle: null,
      demoStarted: false,
      demoPanelRoles: new Map(),
      agentManager: { prepareForShutdown: vi.fn(() => []) },
      layout: { terminalPanels: [] },
      screen: { destroy: vi.fn() },
    });

    const disposal = app.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(TerminalPanel.waitForPendingTerminations).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();

    releaseRetiredPanel();
    await disposal;
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
