import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/screen/dialog/confirm-dialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));
vi.mock('../../src/screen/dialog/codex-micro-test-dialog.js', () => ({
  showCodexMicroTestDialog: vi.fn(),
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
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { showCodexMicroTestDialog } from '../../src/screen/dialog/codex-micro-test-dialog.js';
import { showErrorToast, showToast } from '../../src/screen/toast.js';

const approvedGrid = [
  'Would you like to run the following command?',
  '$ npm run verify',
  '› 1. Yes, proceed',
  "  2. Yes, and don't ask again for commands that start with npm run",
  '  3. No, and tell Codex what to do differently',
];

function createDecisionHarness(grid = approvedGrid) {
  const terminal = {
    panelIndex: 0,
    isRunning: true,
    sessionGeneration: 7,
    inputGeneration: 0n,
    inputSynchronized: true,
    getVisibleGridLines: vi.fn(() => [...grid]),
  };
  const layout = {
    activeTerminalPanel: terminal,
    focusPanelOffset: vi.fn(() => true),
    focusPageOffset: vi.fn(() => true),
    focusVisibleSlot: vi.fn(() => true),
    focusWorkspaceSlot: vi.fn(() => true),
  };
  const agentManager = {
    getAgentType: vi.fn(() => 'codex'),
    getAgentSessionId: vi.fn(() => 'codex-session-0'),
  };
  const orchestrator = {
    submitGuardedCodexDecision: vi.fn(async () => true),
  };
  const app: any = Object.create(App.prototype);
  Object.assign(app, {
    config: {
      hardware: {
        codexMicro: { enabled: true, inputMode: 'native', decisionControls: true },
      },
    },
    layout,
    agentManager,
    orchestrator,
    screen: { key: vi.fn(), render: vi.fn() },
    theme: {},
    disposalStarted: false,
    destructiveTransitionInProgress: false,
    fullScreenOverlayActive: false,
    codexMicroTestDialog: null,
    codexMicroStatus: {
      state: 'connected',
      transport: 'usb',
      connectionEpoch: 'micro-epoch-1',
      ownership: 'guarded',
    },
    pendingCodexMicroDecision: null,
    updateStatus: vi.fn(),
  });
  return { app, terminal, layout, agentManager, orchestrator };
}

describe('App Codex Micro integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms and submits Enter through the guarded exact-session path', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    const { app, terminal, orchestrator } = createDecisionHarness();

    await app.actionCodexMicroDecision('approve');

    expect(showConfirmDialog).toHaveBeenCalledWith(
      app.screen,
      app.theme,
      'Codex Micro — Approve Once',
      expect.stringContaining('Yes, proceed'),
    );
    expect(orchestrator.submitGuardedCodexDecision).toHaveBeenCalledWith(
      terminal,
      expect.objectContaining({
        action: 'approve',
        sessionId: 'codex-session-0',
        sessionGeneration: 7,
        inputGeneration: 0n,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(showToast).toHaveBeenCalledWith(app.screen, 'Submitted selected one-time approval');
  });

  it('fails closed if the prompt changes while confirmation is open', async () => {
    let resolveConfirmation!: (confirmed: boolean) => void;
    vi.mocked(showConfirmDialog).mockReturnValue(new Promise((resolve) => {
      resolveConfirmation = resolve;
    }));
    const { app, terminal, orchestrator } = createDecisionHarness();

    const pending = app.actionCodexMicroDecision('approve');
    await Promise.resolve();
    terminal.getVisibleGridLines.mockReturnValue(['Command completed.', '$ ']);
    resolveConfirmation(true);
    await pending;

    expect(orchestrator.submitGuardedCodexDecision).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      'Codex prompt changed during confirmation; no input was sent',
    );
  });

  it('rejects an approval while prior terminal input has not redrawn', async () => {
    const { app, terminal, orchestrator } = createDecisionHarness();
    terminal.inputGeneration = 1n;
    terminal.inputSynchronized = false;

    await app.actionCodexMicroDecision('approve');

    expect(terminal.getVisibleGridLines).not.toHaveBeenCalled();
    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(orchestrator.submitGuardedCodexDecision).not.toHaveBeenCalled();
  });

  it('never offers confirmation for a selected persistent approval', async () => {
    const persistentGrid = [...approvedGrid];
    persistentGrid[2] = '  1. Yes, proceed';
    persistentGrid[3] = "› 2. Yes, and don't ask again for commands that start with npm run";
    const { app, orchestrator } = createDecisionHarness(persistentGrid);

    await app.actionCodexMicroDecision('approve');

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(orchestrator.submitGuardedCodexDecision).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      expect.stringContaining('selected one-time option'),
    );
  });

  it('records test-overlay controls without executing their normal actions', () => {
    const { app, layout } = createDecisionHarness();
    app.config.hardware.codexMicro.inputMode = 'keyboard';
    const recordAction = vi.fn(() => true);
    const handle = {
      recordAction,
      recordHardwareInput: vi.fn(() => true),
      setDeviceStatus: vi.fn(),
      reset: vi.fn(),
      close: vi.fn(),
      isOpen: vi.fn(() => true),
      testedActions: vi.fn(() => []),
    };
    app.codexMicroTestDialog = handle;
    vi.mocked(showCodexMicroTestDialog).mockReturnValue(handle);

    app.setupGlobalKeys();
    const registration = vi.mocked(app.screen.key).mock.calls.find(
      ([keys]: [string[]]) => keys.includes('C-S-pageup'),
    );
    expect(registration).toBeDefined();
    registration?.[1]();

    expect(recordAction).toHaveBeenCalledWith('previous-panel');
    expect(layout.focusPanelOffset).not.toHaveBeenCalled();
  });

  it('never submits decision actions from the unguarded keyboard fallback', () => {
    const { app, orchestrator } = createDecisionHarness();
    app.config.hardware.codexMicro.inputMode = 'keyboard';
    app.config.hardware.codexMicro.decisionControls = true;

    app.setupGlobalKeys();
    for (const shortcut of ['C-S-f11', 'C-S-f12']) {
      const registration = vi.mocked(app.screen.key).mock.calls.find(
        ([keys]: [string[]]) => keys.includes(shortcut),
      );
      expect(registration).toBeDefined();
      registration?.[1]();
    }

    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(orchestrator.submitGuardedCodexDecision).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledTimes(2);
    expect(showErrorToast).toHaveBeenLastCalledWith(
      app.screen,
      'Codex Micro decisions require native input with the sole-reader guard',
    );
  });

  it('surfaces the unguarded keyboard fallback warning only once', () => {
    const { app } = createDecisionHarness();
    app.config.hardware.codexMicro.inputMode = 'keyboard';
    app.codexMicroKeyboardWarningShown = false;

    app.warnCodexMicroKeyboardFallback();
    app.warnCodexMicroKeyboardFallback();

    expect(showErrorToast).toHaveBeenCalledOnce();
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      'Codex Micro keyboard fallback has NO reader guard; keep ChatGPT fully quit',
    );
  });

  it('routes physical navigation through adaptive workspace helpers', () => {
    const { app, layout } = createDecisionHarness();

    app.runCodexMicroAction('previous-panel');
    app.runCodexMicroAction('next-panel');
    app.runCodexMicroAction('previous-page');
    app.runCodexMicroAction('next-page');
    app.runCodexMicroAction('focus-slot-4');
    app.runCodexMicroAction('focus-panel-6');

    expect(layout.focusPanelOffset.mock.calls).toEqual([[-1], [1]]);
    expect(layout.focusPageOffset.mock.calls).toEqual([[-1], [1]]);
    expect(layout.focusVisibleSlot).toHaveBeenCalledWith(4);
    expect(layout.focusWorkspaceSlot).toHaveBeenCalledWith(6);
    expect(app.updateStatus).toHaveBeenCalledTimes(6);
  });

  it('routes current native events and intercepts them while the hardware checklist is open', () => {
    const { app, layout } = createDecisionHarness();
    const event = {
      source: 'native',
      input: 'AG02',
      action: 'focus-panel-3',
      connectionEpoch: 'micro-epoch-1',
      sequence: 1,
      receivedAt: Date.now(),
    };

    app.handleCodexMicroHardwareEvent(event);
    expect(layout.focusWorkspaceSlot).toHaveBeenCalledWith(3);

    const recordHardwareInput = vi.fn(() => true);
    app.codexMicroTestDialog = {
      recordAction: vi.fn(() => true),
      recordHardwareInput,
      setDeviceStatus: vi.fn(),
      reset: vi.fn(),
      close: vi.fn(),
      isOpen: vi.fn(() => true),
      testedActions: vi.fn(() => []),
    };
    app.handleCodexMicroHardwareEvent({ ...event, sequence: 2, input: 'AG03' });

    expect(recordHardwareInput).toHaveBeenCalledWith('AG03', 'focus-panel-3');
    expect(layout.focusWorkspaceSlot).toHaveBeenCalledTimes(1);
  });

  it('ignores expired and prior-connection hardware events', () => {
    const { app, layout } = createDecisionHarness();
    const base = {
      source: 'native',
      input: 'AG00',
      action: 'focus-panel-1',
      sequence: 1,
    };

    app.handleCodexMicroHardwareEvent({
      ...base,
      connectionEpoch: 'prior-epoch',
      receivedAt: Date.now(),
    });
    app.handleCodexMicroHardwareEvent({
      ...base,
      connectionEpoch: 'micro-epoch-1',
      receivedAt: Date.now() - 5_001,
    });

    expect(layout.focusWorkspaceSlot).not.toHaveBeenCalled();
  });

  it('requires a second current physical decision press and carries origin validation forward', async () => {
    const { app, terminal, orchestrator } = createDecisionHarness();
    let resolveDialog!: (confirmed: boolean) => void;
    const controller = {
      confirm: vi.fn(() => resolveDialog(true)),
      cancel: vi.fn(() => resolveDialog(false)),
      isOpen: vi.fn(() => true),
    };
    vi.mocked(showConfirmDialog).mockImplementation((
      _screen,
      _theme,
      _title,
      _message,
      options,
    ) => new Promise<boolean>((resolve) => {
      resolveDialog = resolve;
      options?.onReady?.(controller);
    }));
    const first = {
      source: 'native',
      input: 'ACT07',
      action: 'approve',
      connectionEpoch: 'micro-epoch-1',
      sequence: 1,
      receivedAt: Date.now(),
    };

    app.handleCodexMicroHardwareEvent(first);
    await Promise.resolve();
    expect(showConfirmDialog).toHaveBeenCalledWith(
      app.screen,
      app.theme,
      'Codex Micro — Approve Once',
      expect.stringContaining('same device key again within 5 seconds'),
      expect.objectContaining({
        externalConfirmOnly: true,
        onReady: expect.any(Function),
      }),
    );
    expect(orchestrator.submitGuardedCodexDecision).not.toHaveBeenCalled();

    app.handleCodexMicroHardwareEvent({ ...first, receivedAt: Date.now() });
    app.handleCodexMicroHardwareEvent({
      ...first,
      input: 'ACT08',
      sequence: 2,
      receivedAt: Date.now(),
    });
    expect(controller.confirm).not.toHaveBeenCalled();

    const second = { ...first, sequence: 2, receivedAt: Date.now() };
    app.handleCodexMicroHardwareEvent(second);
    await vi.waitFor(() => {
      expect(orchestrator.submitGuardedCodexDecision).toHaveBeenCalledOnce();
    });

    expect(controller.confirm).toHaveBeenCalledOnce();
    const [submittedTerminal, expected] = orchestrator.submitGuardedCodexDecision.mock.calls[0];
    expect(submittedTerminal).toBe(terminal);
    expect(expected).toMatchObject({
      action: 'approve',
      sessionId: 'codex-session-0',
      validateOrigin: expect.any(Function),
    });
    expect(expected.validateOrigin()).toBe(true);

    app.codexMicroStatus = {
      state: 'disconnected',
      transport: 'unknown',
      connectionEpoch: null,
    };
    expect(expected.validateOrigin()).toBe(false);
  });

  it('expires the physical decision dialog and treats a late press as a new request', async () => {
    vi.useFakeTimers();
    try {
      const { app, orchestrator } = createDecisionHarness();
      let resolveDialog!: (confirmed: boolean) => void;
      const controller = {
        confirm: vi.fn(() => resolveDialog(true)),
        cancel: vi.fn(() => resolveDialog(false)),
        isOpen: vi.fn(() => true),
      };
      vi.mocked(showConfirmDialog).mockImplementation((
        _screen,
        _theme,
        _title,
        _message,
        options,
      ) => new Promise<boolean>((resolve) => {
        resolveDialog = resolve;
        options?.onReady?.(controller);
      }));
      const first = {
        source: 'native',
        input: 'ACT07',
        action: 'approve',
        connectionEpoch: 'micro-epoch-1',
        sequence: 1,
        receivedAt: Date.now(),
      };

      app.handleCodexMicroHardwareEvent(first);
      await vi.advanceTimersByTimeAsync(5_001);

      expect(controller.cancel).toHaveBeenCalledOnce();
      expect(orchestrator.submitGuardedCodexDecision).not.toHaveBeenCalled();
      expect(app.pendingCodexMicroDecision).toBeNull();

      app.handleCodexMicroHardwareEvent({
        ...first,
        sequence: 2,
        receivedAt: Date.now(),
      });
      await Promise.resolve();

      expect(showConfirmDialog).toHaveBeenCalledTimes(2);
      expect(controller.confirm).not.toHaveBeenCalled();
      expect(orchestrator.submitGuardedCodexDecision).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_001);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending physical decision when the device epoch disconnects', () => {
    const { app } = createDecisionHarness();
    const cancel = vi.fn();
    app.pendingCodexMicroDecision = {
      action: 'approve',
      event: {
        source: 'native',
        input: 'ACT07',
        action: 'approve',
        connectionEpoch: 'micro-epoch-1',
        sequence: 1,
        receivedAt: Date.now(),
      },
      controller: { cancel, confirm: vi.fn(), isOpen: vi.fn(() => true) },
      expiresAt: Date.now() + 5_000,
      timeout: null,
    };
    app.codexMicroTestDialog = {
      recordAction: vi.fn(),
      recordHardwareInput: vi.fn(),
      setDeviceStatus: vi.fn(),
      reset: vi.fn(),
      close: vi.fn(),
      isOpen: vi.fn(() => false),
      testedActions: vi.fn(() => []),
    };

    app.handleCodexMicroStatus({
      state: 'disconnected',
      transport: 'unknown',
      connectionEpoch: null,
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(app.pendingCodexMicroDecision).toBeNull();
    expect(app.codexMicroTestDialog.setDeviceStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'disconnected' }),
    );
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      'Codex Micro disconnected; hardware actions are paused',
    );
  });

  it('fails closed on a competing reader, cancels decisions, and reports MICRO:BUSY once', () => {
    const { app, layout } = createDecisionHarness();
    const cancel = vi.fn();
    app.pendingCodexMicroDecision = {
      action: 'approve',
      event: {
        source: 'native',
        input: 'ACT07',
        action: 'approve',
        connectionEpoch: 'micro-epoch-1',
        sequence: 1,
        receivedAt: Date.now(),
      },
      controller: { cancel, confirm: vi.fn(), isOpen: vi.fn(() => true) },
      expiresAt: Date.now() + 5_000,
      timeout: setTimeout(() => undefined, 5_000),
    };
    app.launch = { conference: false, demo: false };

    const busyStatus = {
      state: 'busy',
      transport: 'usb',
      connectionEpoch: null,
      detail: 'another_hid_client',
    };
    app.handleCodexMicroStatus(busyStatus);
    app.handleCodexMicroHardwareEvent({
      source: 'native',
      input: 'AG00',
      action: 'focus-panel-1',
      connectionEpoch: 'micro-epoch-1',
      sequence: 2,
      receivedAt: Date.now(),
    });
    app.handleCodexMicroStatus(busyStatus);

    expect(cancel).toHaveBeenCalledOnce();
    expect(app.pendingCodexMicroDecision).toBeNull();
    expect(layout.focusWorkspaceSlot).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledOnce();
    expect(showErrorToast).toHaveBeenCalledWith(
      app.screen,
      'Codex Micro is open in ChatGPT or another app; Commander controls are paused',
    );
    expect(app.conferenceStatus()).toEqual({ modeLabel: 'MICRO:BUSY' });

    app.handleCodexMicroStatus({
      state: 'connected',
      transport: 'usb',
      connectionEpoch: 'micro-epoch-2',
      ownership: 'guarded',
    });
    expect(showToast).toHaveBeenCalledWith(
      app.screen,
      'Codex Micro ready for Commander (USB)',
      2000,
    );
  });

  it('does not pre-check the overlay action when test mode opens automatically', () => {
    const { app } = createDecisionHarness();
    const handle = {
      recordAction: vi.fn(() => true),
      recordHardwareInput: vi.fn(() => true),
      setDeviceStatus: vi.fn(),
      reset: vi.fn(),
      close: vi.fn(),
      isOpen: vi.fn(() => true),
      testedActions: vi.fn(() => []),
    };
    vi.mocked(showCodexMicroTestDialog).mockReturnValue(handle);

    app.openCodexMicroTest(false);

    expect(handle.recordAction).not.toHaveBeenCalled();
    expect(app.codexMicroTestDialog).toBe(handle);
  });
});
