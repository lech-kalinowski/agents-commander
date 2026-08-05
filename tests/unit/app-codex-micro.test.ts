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
        codexMicro: { enabled: true, decisionControls: true },
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
    const recordAction = vi.fn(() => true);
    const handle = {
      recordAction,
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

  it('routes physical navigation through adaptive workspace helpers', () => {
    const { app, layout } = createDecisionHarness();

    app.runCodexMicroAction('previous-panel');
    app.runCodexMicroAction('next-panel');
    app.runCodexMicroAction('previous-page');
    app.runCodexMicroAction('next-page');
    app.runCodexMicroAction('focus-slot-4');

    expect(layout.focusPanelOffset.mock.calls).toEqual([[-1], [1]]);
    expect(layout.focusPageOffset.mock.calls).toEqual([[-1], [1]]);
    expect(layout.focusVisibleSlot).toHaveBeenCalledWith(4);
    expect(app.updateStatus).toHaveBeenCalledTimes(5);
  });

  it('does not pre-check the overlay action when test mode opens automatically', () => {
    const { app } = createDecisionHarness();
    const handle = {
      recordAction: vi.fn(() => true),
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
