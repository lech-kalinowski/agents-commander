import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogMocks = vi.hoisted(() => ({
  showActivityDialog: vi.fn(),
  showProtocolGuide: vi.fn(),
}));

vi.mock('../../src/screen/dialog/activity-dialog.js', () => ({
  showActivityDialog: dialogMocks.showActivityDialog,
}));

vi.mock('../../src/screen/dialog/protocol-dialog.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/screen/dialog/protocol-dialog.js')>(),
  showProtocolGuide: dialogMocks.showProtocolGuide,
}));

import { App } from '../../src/app.js';
import { HELP_TEXT } from '../../src/screen/dialog/help-dialog.js';
import { GUIDE_TEXT } from '../../src/screen/dialog/protocol-dialog.js';
import {
  COMPACT_WELCOME_TEXT,
  WELCOME_TEXT,
} from '../../src/screen/dialog/welcome-dialog.js';

function createHarness(options: { filePanel?: boolean; liveTerminal?: boolean } = {}) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const screen = {
    key: vi.fn((keys: string[], handler: (...args: any[]) => void) => {
      for (const key of keys) handlers.set(key, handler);
    }),
    render: vi.fn(),
  };
  const activeFilePanel = options.filePanel
    ? { currentEntry: null }
    : null;
  const layout = {
    activeFilePanel,
    activeTerminalPanel: options.liveTerminal ? { isRunning: true } : null,
  };
  const orchestrator = {
    getRecentActivity: vi.fn(() => []),
  };
  const app: any = Object.create(App.prototype);
  Object.assign(app, {
    screen,
    theme: { dialog: {} },
    layout,
    orchestrator,
    fullScreenOverlayActive: false,
  });
  app.setupGlobalKeys();
  return { handlers, orchestrator, screen };
}

describe('Activity and protocol shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('binds plain F12 only to routed-message Activity', () => {
    const { handlers, orchestrator, screen } = createHarness({ liveTerminal: true });

    handlers.get('f12')?.();

    expect(dialogMocks.showActivityDialog).toHaveBeenCalledOnce();
    expect(dialogMocks.showProtocolGuide).not.toHaveBeenCalled();

    const [, , provider] = dialogMocks.showActivityDialog.mock.calls[0];
    provider(7);
    expect(orchestrator.getRecentActivity).toHaveBeenCalledWith(7);
    expect(dialogMocks.showActivityDialog).toHaveBeenCalledWith(
      screen,
      expect.anything(),
      expect.any(Function),
    );
  });

  it('binds Shift+F12 only to the protocol guide, including from a live terminal', () => {
    const { handlers } = createHarness({ liveTerminal: true });

    handlers.get('S-f12')?.();

    expect(dialogMocks.showProtocolGuide).toHaveBeenCalledOnce();
    expect(dialogMocks.showActivityDialog).not.toHaveBeenCalled();
  });

  it('retains the Ctrl+G file-panel fallback route to the protocol guide', () => {
    const { handlers } = createHarness({ filePanel: true });

    handlers.get('C-g')?.();

    expect(dialogMocks.showProtocolGuide).toHaveBeenCalledOnce();
    expect(dialogMocks.showActivityDialog).not.toHaveBeenCalled();
  });

  it('documents the Activity scope and the moved protocol-guide shortcut', () => {
    for (const copy of [HELP_TEXT, WELCOME_TEXT, COMPACT_WELCOME_TEXT]) {
      expect(copy).toContain('F12');
      expect(copy).toContain('Routed-message activity');
      expect(copy).toContain('Shift+F12');
      expect(copy.toLowerCase()).toContain('protocol guide');
    }

    expect(HELP_TEXT).toContain('SEND/REPLY/BROADCAST history');
    expect(GUIDE_TEXT).toContain('F12{/cyan-fg}         Routed-message activity');
    expect(GUIDE_TEXT).toContain('Shift+F12{/cyan-fg}   This guide');
  });
});
