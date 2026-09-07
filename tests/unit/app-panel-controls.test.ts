import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/screen/dialog/input-dialog.js', () => ({ showInputDialog: vi.fn() }));
vi.mock('../../src/screen/dialog/confirm-dialog.js', () => ({ showConfirmDialog: vi.fn() }));
vi.mock('../../src/screen/toast.js', () => ({ showToast: vi.fn(), showErrorToast: vi.fn() }));

import { App } from '../../src/app.js';
import { FilePanel } from '../../src/panels/file-panel.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { showInputDialog } from '../../src/screen/dialog/input-dialog.js';
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { showErrorToast } from '../../src/screen/toast.js';

function file(panelIndex: number, cwd = '/repo/nested'): any {
  return Object.assign(Object.create(FilePanel.prototype), { panelIndex, _currentPath: cwd });
}

function terminal(panelIndex: number, running = true): any {
  return Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex, cwd: '/repo/agent', _status: running ? 'running' : 'idle',
    agentName: 'Source', proc: running ? { stdin: { writable: true } } : null,
    killAgent: vi.fn(async () => undefined),
  });
}

function harness(kind: 'file' | 'managed' | 'unmanaged' = 'file') {
  const source = kind === 'file' ? file(8) : terminal(8);
  const panels: any[] = [file(2, '/other'), source];
  let active = source;
  let nextId = 10;
  const sessions: any[] = kind === 'managed' ? [{
    panelIndex: 8, sessionId: 'source-session', type: 'opencode',
    profileId: 'custom-reviewer', profileLabel: 'Local reviewer', name: 'OpenCode',
    status: 'running',
  }] : [];
  const layout: any = {
    isFullscreen: false,
    mode: 2,
    get activePanel() { return active; },
    get activeTerminalPanel() { return active instanceof TerminalPanel ? active : null; },
    get activeFilePanel() { return active instanceof FilePanel ? active : null; },
    get panelCount() { return panels.length; },
    get workspacePanelIds() { return panels.map((p) => p.panelIndex); },
    get allPanels() { return panels; },
    get terminalPanels() { return panels.filter((p) => p instanceof TerminalPanel); },
    getPanel: vi.fn((id) => panels.find((p) => p.panelIndex === id) ?? null),
    hasPanel: vi.fn((id) => panels.some((p) => p.panelIndex === id)),
    getTerminalPanel: vi.fn((id) => panels.find((p) => p.panelIndex === id && p instanceof TerminalPanel) ?? null),
    getWorkspacePosition: vi.fn((id) => panels.findIndex((p) => p.panelIndex === id) + 1),
    addPanel: vi.fn(async (cwd) => { active = file(nextId++, cwd); panels.push(active); return true; }),
    convertToTerminal: vi.fn((id) => {
      const index = panels.findIndex((p) => p.panelIndex === id);
      const p = terminal(id, false);
      p.cwd = panels[index].currentPath;
      panels[index] = p;
      return p;
    }),
    setActivePanel: vi.fn((id) => { active = panels.find((p) => p.panelIndex === id); }),
    removePanel: vi.fn((id) => { panels.splice(panels.findIndex((p) => p.panelIndex === id), 1); return true; }),
    movePanel: vi.fn((id, position) => {
      const [p] = panels.splice(panels.findIndex((p) => p.panelIndex === id), 1);
      panels.splice(position - 1, 0, p);
      return true;
    }),
    toggleFullscreen: vi.fn(() => { layout.isFullscreen = !layout.isFullscreen; return layout.isFullscreen; }),
    setMode: vi.fn(async () => undefined),
  };
  const manager: any = {
    getRunningAgents: vi.fn(() => sessions),
    getProfileLaunchError: vi.fn(() => null),
    launchProfile: vi.fn(() => true),
    hasAgent: vi.fn((id) => sessions.some((s) => s.panelIndex === id)),
    killAgent: vi.fn(async () => undefined),
    handlePanelRemoval: vi.fn(),
  };
  const orchestrator: any = {
    connectPanel: vi.fn(), disconnectPanel: vi.fn(), handlePanelRemoval: vi.fn(),
    injectProtocol: vi.fn(), sendTask: vi.fn(),
  };
  const app: any = Object.assign(Object.create(App.prototype), {
    layout, agentManager: manager, orchestrator,
    screen: { render: vi.fn(), key: vi.fn() }, theme: {}, config: {},
    updateStatus: vi.fn(), disposalStarted: false, destructiveTransitionInProgress: false,
    fullScreenOverlayActive: false,
  });
  return { app, layout, manager, orchestrator, source, panels, sessions };
}

beforeEach(() => vi.clearAllMocks());

describe('panel-first function keys', () => {
  it('dispatches panel actions and retains secondary file shortcuts', () => {
    const { app } = harness();
    const actions = {
      f4: 'actionToggleFullscreen', f5: 'actionEditFile', f6: 'actionDuplicatePanel',
      f7: 'actionMovePanel', f8: 'actionMkdir', f9: 'actionRemovePanel',
      'S-f6': 'actionCopy', 'S-f7': 'actionMove', 'S-f9': 'actionDelete',
    };
    for (const name of Object.values(actions)) app[name] = vi.fn();
    app.setupGlobalKeys();
    for (const [key, action] of Object.entries(actions)) {
      const binding = app.screen.key.mock.calls.find(([keys]: [string[]]) => keys.includes(key));
      expect(binding).toBeDefined();
      binding[1]();
      expect(app[action]).toHaveBeenCalledOnce();
    }
  });

  it('does not execute secondary file actions from a running terminal', () => {
    const { app } = harness('managed');
    app.actionCopy = vi.fn(); app.actionMove = vi.fn(); app.actionDelete = vi.fn();
    app.setupGlobalKeys();
    for (const key of ['S-f6', 'S-f7', 'S-f9']) {
      app.screen.key.mock.calls.find(([keys]: [string[]]) => keys.includes(key))[1]();
    }
    expect(app.actionCopy).not.toHaveBeenCalled();
    expect(app.actionMove).not.toHaveBeenCalled();
    expect(app.actionDelete).not.toHaveBeenCalled();
  });

  it('toggles fullscreen without entering an input-blocking overlay', () => {
    const { app, layout } = harness('managed');
    app.actionToggleFullscreen();
    expect(layout.isFullscreen).toBe(true);
    expect(app.fullScreenOverlayActive).toBe(false);
    app.actionToggleFullscreen();
    expect(layout.isFullscreen).toBe(false);
    expect(app.updateStatus).toHaveBeenCalledTimes(2);
  });

  it('applies an explicit density selection even when fullscreen preserves that density', async () => {
    const { app, layout } = harness();
    layout.isFullscreen = true;
    await app.actionChangeLayout(2);
    expect(layout.setMode).toHaveBeenCalledWith(2);
  });
});

describe('panel duplication', () => {
  it('copies a file panel directory without launching an agent or mutating the source', async () => {
    const { app, layout, manager, source } = harness();
    await app.actionDuplicatePanel();
    expect(layout.addPanel).toHaveBeenCalledWith('/repo/nested');
    expect(layout.activePanel).not.toBe(source);
    expect(layout.activePanel.currentPath).toBe('/repo/nested');
    expect(layout.convertToTerminal).not.toHaveBeenCalled();
    expect(manager.launchProfile).not.toHaveBeenCalled();
  });

  it('launches exactly the same custom profile with fresh, unarmed protocol state', async () => {
    const { app, layout, manager, orchestrator, source } = harness('managed');
    await app.actionDuplicatePanel();
    expect(manager.getProfileLaunchError).toHaveBeenCalledWith('custom-reviewer', 'opencode');
    expect(layout.addPanel).toHaveBeenCalledWith('/repo/agent');
    expect(manager.launchProfile).toHaveBeenCalledWith('custom-reviewer', layout.activePanel);
    expect(layout.activePanel.panelIndex).toBe(10);
    expect(layout.activePanel.workingDir).toBe(source.workingDir);
    expect(orchestrator.connectPanel).toHaveBeenCalledWith(layout.activePanel);
    expect(orchestrator.injectProtocol).not.toHaveBeenCalled();
    expect(orchestrator.sendTask).not.toHaveBeenCalled();
    expect(manager.killAgent).not.toHaveBeenCalled();
    expect(source.killAgent).not.toHaveBeenCalled();
  });

  it('resolves the new panel by allocated ID even if focus changes during directory loading', async () => {
    const { app, layout, manager, source } = harness('managed');
    const add = layout.addPanel.getMockImplementation();
    layout.addPanel.mockImplementation(async (cwd: string) => {
      await add(cwd);
      layout.setActivePanel(source.panelIndex);
      return true;
    });
    await app.actionDuplicatePanel();
    expect(manager.launchProfile.mock.calls[0][1].panelIndex).toBe(10);
    expect(source.panelIndex).toBe(8);
  });

  it('copies unmanaged terminals as idle terminals without replaying their commands', async () => {
    const { app, layout, manager, source } = harness('unmanaged');
    await app.actionDuplicatePanel();
    expect(layout.activePanel).toBeInstanceOf(TerminalPanel);
    expect(layout.activePanel.isRunning).toBe(false);
    expect(manager.launchProfile).not.toHaveBeenCalled();
    expect(source.killAgent).not.toHaveBeenCalled();
  });

  it.each(['internal', 'invalid-profile'])('rejects unsupported source profile %s before adding a panel', async (profile) => {
    const { app, layout, manager, sessions } = harness('managed');
    sessions[0].profileId = profile;
    if (profile !== 'internal') manager.getProfileLaunchError.mockReturnValue('Invalid profile');
    await app.actionDuplicatePanel();
    expect(layout.addPanel).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalled();
  });

  it('respects the panel cap without launching or replacing any process', async () => {
    const { app, layout, manager } = harness('managed');
    layout.addPanel.mockResolvedValue(false);
    await app.actionDuplicatePanel();
    expect(manager.launchProfile).not.toHaveBeenCalled();
    expect(manager.killAgent).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(app.screen, expect.stringContaining('limit reached'));
  });

  it('keeps the source untouched when launch fails in the new panel', async () => {
    const { app, manager, source, orchestrator } = harness('managed');
    manager.launchProfile.mockReturnValue(false);
    await app.actionDuplicatePanel();
    expect(source.killAgent).not.toHaveBeenCalled();
    expect(manager.killAgent).not.toHaveBeenCalled();
    expect(orchestrator.connectPanel).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(app.screen, expect.stringContaining('source session is unchanged'));
  });

  it('does not launch after shutdown begins during directory loading', async () => {
    const { app, layout, manager } = harness('managed');
    layout.addPanel.mockImplementation(async () => { app.disposalStarted = true; return true; });
    await app.actionDuplicatePanel();
    expect(manager.launchProfile).not.toHaveBeenCalled();
  });
});

describe('panel order and closure', () => {
  it('moves workspace position without renumbering protocol identity or touching sessions', async () => {
    const { app, layout, source, manager, orchestrator } = harness('managed');
    vi.mocked(showInputDialog).mockResolvedValue('1');
    await app.actionMovePanel();
    expect(layout.movePanel).toHaveBeenCalledWith(8, 1);
    expect(layout.workspacePanelIds).toEqual([8, 2]);
    expect(source.panelIndex).toBe(8);
    expect(app.panelSummaries()[0]).toMatchObject({ panelId: 8, panelNumber: 9, workspacePosition: 1 });
    expect(manager.killAgent).not.toHaveBeenCalled();
    expect(orchestrator.disconnectPanel).not.toHaveBeenCalled();
  });

  it.each([null, '0', '3', '-1', '1.5', '1e0', 'abc'])('does not reorder for cancelled/invalid position %s', async (input) => {
    const { app, layout } = harness();
    vi.mocked(showInputDialog).mockResolvedValue(input);
    await app.actionMovePanel();
    expect(layout.movePanel).not.toHaveBeenCalled();
  });

  it('does not move a replacement panel after the original dialog target disappears', async () => {
    const { app, layout, panels } = harness();
    vi.mocked(showInputDialog).mockImplementation(async () => { panels[1] = file(8); return '1'; });
    await app.actionMovePanel();
    expect(layout.movePanel).not.toHaveBeenCalled();
  });

  it('preserves live and restarting agents when F9 confirmation is declined', async () => {
    const { app, layout, manager, sessions } = harness('managed');
    sessions[0].status = 'restarting';
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    await app.actionRemovePanel();
    expect(showConfirmDialog).toHaveBeenCalled();
    expect(manager.killAgent).not.toHaveBeenCalled();
    expect(layout.removePanel).not.toHaveBeenCalled();
  });

  it('never removes the last remaining panel', async () => {
    const { app, layout, panels } = harness();
    panels.shift();
    await app.actionRemovePanel();
    expect(layout.removePanel).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(app.screen, expect.stringContaining('at least one panel'));
  });
});
