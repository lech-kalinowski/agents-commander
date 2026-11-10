import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/utils/shell-launch.js', () => ({ buildShellLaunchSpec: vi.fn() }));
vi.mock('../../src/screen/toast.js', () => ({ showToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('../../src/screen/dialog/agent-dialog.js', () => ({ showAgentDialog: vi.fn() }));
import { App } from '../../src/app.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { buildShellLaunchSpec } from '../../src/utils/shell-launch.js';
import { showAgentDialog } from '../../src/screen/dialog/agent-dialog.js';
import { showErrorToast } from '../../src/screen/toast.js';

function fixture(live = false) {
  const terminal = { launchCommand: vi.fn(() => true), sessionGeneration: 1 };
  const app: any = Object.assign(Object.create(App.prototype), {
    config: {}, theme: {}, screen: { render: vi.fn() },
    layout: { getPanel: vi.fn(() => terminal), getTerminalPanel: vi.fn(() => terminal),
      convertToTerminal: vi.fn(() => terminal), setActivePanel: vi.fn(),
      activePanel: { panelIndex: 5 }, workspacePanelIds: [0, 5] },
    orchestrator: { disconnectPanel: vi.fn(), connectPanel: vi.fn(), injectProtocol: vi.fn() },
    agentManager: { launchProfile: vi.fn() },
    hasLiveTerminalSession: vi.fn(() => live),
    confirmSessionReplacement: vi.fn(async () => true),
    stopTerminalSession: vi.fn(async () => { app.hasLiveTerminalSession.mockReturnValue(false); }),
    updateStatus: vi.fn(),
  });
  return { app, terminal };
}

describe('plain shell panels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildShellLaunchSpec).mockReturnValue({ label: 'Shell (zsh)', command: '/bin/zsh', args: ['-i'] });
  });

  it('launches F2/S as an unmanaged command, never an AI profile or protocol target', async () => {
    const { app, terminal } = fixture();
    vi.mocked(showAgentDialog).mockResolvedValue({ action: 'shell', panelIndex: 5 });
    await app.actionLaunchAgent();
    expect(terminal.launchCommand).toHaveBeenCalledWith('Shell (zsh)', '/bin/zsh', ['-i']);
    expect(app.layout.convertToTerminal).toHaveBeenCalledWith(5);
    expect(app.orchestrator.disconnectPanel).toHaveBeenCalledWith(5);
    expect(app.orchestrator.connectPanel).not.toHaveBeenCalled();
    expect(app.orchestrator.injectProtocol).not.toHaveBeenCalled();
    expect(app.agentManager.launchProfile).not.toHaveBeenCalled();
  });

  it('requires confirmation and waits for the old process before replacing it', async () => {
    const { app, terminal } = fixture(true);
    await app.actionLaunchShell(5);
    expect(app.confirmSessionReplacement).toHaveBeenCalledWith(5, 'launch a shell');
    expect(app.stopTerminalSession).toHaveBeenCalledWith(5);
    expect(terminal.launchCommand).toHaveBeenCalledOnce();
  });

  it.each(['declined', 'replaced', 'restarted', 'disposed', 'new-session'])(
    'does not replace a session after %s', async condition => {
      const { app, terminal } = fixture(true);
      app.confirmSessionReplacement.mockImplementation(async () => {
        if (condition === 'replaced') app.layout.getPanel.mockReturnValue({});
        if (condition === 'restarted') terminal.sessionGeneration++;
        if (condition === 'disposed') app.disposalStarted = true;
        return condition !== 'declined';
      });
      if (condition === 'new-session') app.stopTerminalSession.mockResolvedValue(undefined);
      await app.actionLaunchShell(5);
      expect(terminal.launchCommand).not.toHaveBeenCalled();
      if (condition !== 'new-session') expect(app.stopTerminalSession).not.toHaveBeenCalled();
    },
  );

  it('does not kill a live session when shell resolution fails', async () => {
    const { app } = fixture(true);
    vi.mocked(buildShellLaunchSpec).mockImplementation(() => { throw new Error('missing shell'); });
    await app.actionLaunchShell(5);
    expect(app.stopTerminalSession).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalled();
  });

  it('launchCommand disables protocol scanning and has no automatic exit action', () => {
    const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
      canLaunchSession: () => true, initVTerm: vi.fn(), launchSession: vi.fn(() => true),
    });
    expect(panel.launchCommand('Shell', '/bin/sh', ['-i'])).toBe(true);
    expect(panel.agentType).toBeNull();
    expect(panel.exitHandler).toBeNull();
    expect(panel.launchSession).toHaveBeenCalledWith('/bin/sh', ['-i'], {}, false, 'inherit');
  });
});
