import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/screen/dialog/agent-dialog.js', () => ({ showAgentDialog: vi.fn() }));
vi.mock('../../src/screen/dialog/confirm-dialog.js', () => ({ showConfirmDialog: vi.fn(async () => true) }));
vi.mock('../../src/screen/dialog/bulk-launch-progress.js', () => ({ showBulkLaunchProgress: vi.fn() }));
vi.mock('../../src/screen/toast.js', () => ({ showToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('../../src/utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { App } from '../../src/app.js';
import { FilePanel } from '../../src/panels/file-panel.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { showAgentDialog } from '../../src/screen/dialog/agent-dialog.js';
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { showBulkLaunchProgress } from '../../src/screen/dialog/bulk-launch-progress.js';
import { showErrorToast, showToast } from '../../src/screen/toast.js';
import type { AgentLifecycleEvent } from '../../src/agents/agent-manager.js';

function file(id: number, cwd = '/repo') {
  return Object.assign(Object.create(FilePanel.prototype), { panelIndex: id, _currentPath: cwd });
}
function terminal(id: number, cwd: string, running = false) {
  return Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex: id, cwd, _status: running ? 'running' : 'idle', killAgent: vi.fn(),
  });
}
function harness() {
  const source = terminal(7, '/repo/apex', true);
  const panels = [source, file(2, '/different'), terminal(4, '/restarting')];
  const originals = [...panels];
  let nextId = 12;
  let active = source;
  let listener: ((event: AgentLifecycleEvent) => void) | undefined;
  const unsubscribe = vi.fn(() => { listener = undefined; });
  const progress = { cancelled: false, update: vi.fn(), close: vi.fn() };
  vi.mocked(showBulkLaunchProgress).mockReturnValue(progress);
  const sessions = new Set([7, 4]);
  const layout = {
    get workspacePanelIds() { return panels.map(p => p.panelIndex); },
    get availablePanelCapacity() { return 100 - panels.length; },
    get activePanel() { return active; },
    get panelCount() { return panels.length; },
    getPanel: vi.fn((id: number) => panels.find(p => p.panelIndex === id) ?? null),
    hasPanel: vi.fn((id: number) => panels.some(p => p.panelIndex === id)),
    addPanel: vi.fn(async (cwd: string, _options?: { activate?: boolean }) => {
      panels.push(file(nextId++, cwd));
      return true;
    }),
    convertToTerminal: vi.fn((id: number) => {
      const index = panels.findIndex(p => p.panelIndex === id);
      const tp = terminal(id, panels[index].currentPath);
      panels[index] = tp;
      return tp;
    }),
    setActivePanel: vi.fn((id: number) => { active = panels.find(p => p.panelIndex === id); }),
    removePanel: vi.fn(),
  };
  const manager = {
    getProfileLaunchError: vi.fn((): string | null => null),
    hasAgent: vi.fn((id: number) => sessions.has(id)),
    launchProfile: vi.fn((_profile: string, panel: any) => { sessions.add(panel.panelIndex); return true; }),
    killAgent: vi.fn(),
    onLifecycle: vi.fn((callback: typeof listener) => { listener = callback; return unsubscribe; }),
  };
  const orchestrator = { connectPanel: vi.fn(), disconnectPanel: vi.fn(), injectProtocol: vi.fn(), sendTask: vi.fn() };
  const app: any = Object.assign(Object.create(App.prototype), {
    layout, agentManager: manager, orchestrator,
    screen: { render: vi.fn() }, theme: {}, config: { agents: {}, agentProfiles: [] },
    updateStatus: vi.fn(), disposalStarted: false, destructiveTransitionInProgress: false,
  });
  const choice = (count: unknown = 16) => ({ agentType: 'generic', profileId: 'apex-pi-custom', panelIndex: 7, newPanelCount: count });
  const exit = (panelIndex: number) => listener?.({
    type: 'exited', panelIndex, sessionId: `session-${panelIndex}`, agentType: 'generic',
    agentName: 'Synthetic APEX', profileId: 'apex-pi-custom', profileLabel: 'Synthetic APEX',
    exitCode: 1, signal: null, reason: 'spawn-error',
  });
  return { app, layout, manager, orchestrator, panels, originals, source, progress, choice, exit, unsubscribe };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(showConfirmDialog).mockResolvedValue(true);
});

describe('new-panel batch launch', () => {
  it.each([1, 10, 16, 20])('starts %i copies of the exact profile in new stable panels only', async count => {
    const h = harness();
    await h.app.actionLaunchAgentBatch(h.choice(count));
    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(showConfirmDialog).toHaveBeenCalledWith(h.app.screen, h.app.theme, 'Launch New Terminals', expect.stringContaining('provider charges may apply'));
    expect(h.layout.addPanel).toHaveBeenCalledTimes(count);
    expect(h.layout.addPanel).toHaveBeenCalledWith('/repo/apex', { activate: false });
    expect(h.panels.slice(0, 3)).toEqual(h.originals);
    expect(h.layout.workspacePanelIds).toEqual([7, 2, 4, ...Array.from({ length: count }, (_, i) => 12 + i)]);
    expect(h.manager.launchProfile).toHaveBeenCalledTimes(count);
    for (const [profile, panel] of h.manager.launchProfile.mock.calls) {
      expect(profile).toBe('apex-pi-custom');
      expect(panel.workingDir).toBe('/repo/apex');
      expect(h.originals).not.toContain(panel);
    }
    expect(h.orchestrator.connectPanel).toHaveBeenCalledTimes(count);
    expect(h.manager.killAgent).not.toHaveBeenCalled();
    expect(h.source.killAgent).not.toHaveBeenCalled();
    expect(h.layout.removePanel).not.toHaveBeenCalled();
    expect(h.orchestrator.injectProtocol).not.toHaveBeenCalled();
    expect(h.orchestrator.sendTask).not.toHaveBeenCalled();
    expect(h.progress.close).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.app.destructiveTransitionInProgress).toBe(false);
  });

  it.each([undefined, null, 0, -1, 1.5, '16', NaN, Infinity, 98, 101])('rejects invalid or over-capacity count %s without mutations', async count => {
    const h = harness();
    await h.app.actionLaunchAgentBatch({ ...h.choice(), newPanelCount: count });
    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(h.layout.addPanel).not.toHaveBeenCalled();
    expect(h.manager.launchProfile).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalled();
  });

  it('rejects an invalid profile before allocating panels', async () => {
    const h = harness();
    h.manager.getProfileLaunchError.mockReturnValue('Invalid profile');
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(h.layout.addPanel).not.toHaveBeenCalled();
  });

  it('makes no changes when confirmation is declined', async () => {
    const h = harness();
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.layout.addPanel).not.toHaveBeenCalled();
    expect(showBulkLaunchProgress).not.toHaveBeenCalled();
  });

  it.each(['source', 'directory', 'capacity', 'profile', 'shutdown'])('revalidates %s after confirmation', async mutation => {
    const h = harness();
    vi.mocked(showConfirmDialog).mockImplementation(async () => {
      if (mutation === 'source') h.panels[0] = terminal(7, '/repo/apex', true);
      if (mutation === 'directory') h.source.cwd = '/another';
      if (mutation === 'capacity') Object.defineProperty(h.layout, 'availablePanelCapacity', { get: () => 0 });
      if (mutation === 'profile') h.manager.getProfileLaunchError.mockReturnValue('Missing executable');
      if (mutation === 'shutdown') h.app.disposalStarted = true;
      return true;
    });
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.layout.addPanel).not.toHaveBeenCalled();
  });

  it('resolves new IDs independently of focus changes during allocation', async () => {
    const h = harness();
    const add = h.layout.addPanel.getMockImplementation()!;
    h.layout.addPanel.mockImplementation(async cwd => {
      const result = await add(cwd);
      h.layout.setActivePanel(2);
      return result;
    });
    await h.app.actionLaunchAgentBatch(h.choice(2));
    expect(h.manager.launchProfile.mock.calls.map(([, p]) => p.panelIndex)).toEqual([12, 13]);
  });

  it.each(['cancel', 'shutdown', 'occupied'])('does not launch after %s during allocation', async action => {
    const h = harness();
    const add = h.layout.addPanel.getMockImplementation()!;
    h.layout.addPanel.mockImplementation(async cwd => {
      await add(cwd);
      if (action === 'cancel') h.progress.cancelled = true;
      if (action === 'shutdown') h.app.disposalStarted = true;
      if (action === 'occupied') h.panels[h.panels.length - 1] = terminal(12, cwd, true);
      return true;
    });
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.layout.addPanel).toHaveBeenCalledOnce();
    expect(h.manager.launchProfile).not.toHaveBeenCalled();
    expect(h.manager.killAgent).not.toHaveBeenCalled();
    expect(h.progress.close).toHaveBeenCalledOnce();
  });

  it('stops on launch failure and retains successful and failed panels', async () => {
    const h = harness();
    h.manager.launchProfile.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.layout.addPanel).toHaveBeenCalledTimes(2);
    expect(h.orchestrator.connectPanel).toHaveBeenCalledOnce();
    expect(h.panels).toHaveLength(5);
    expect(h.layout.removePanel).not.toHaveBeenCalled();
    expect(h.layout.setActivePanel).toHaveBeenCalledWith(13);
    expect(showErrorToast).toHaveBeenCalledWith(h.app.screen, expect.stringContaining('1/16 CLI processes started.'), 6000);
  });

  it('stops scheduling on early lifecycle exit, retaining diagnostics', async () => {
    const h = harness();
    h.progress.update.mockImplementation(() => h.exit(12));
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.layout.addPanel).toHaveBeenCalledOnce();
    expect(showErrorToast).toHaveBeenCalledWith(h.app.screen, expect.stringContaining('P13 exited'), 6000);
  });

  it('does not connect or continue after disposal begins during launch', async () => {
    const h = harness();
    h.manager.launchProfile.mockImplementation(() => { h.app.disposalStarted = true; return true; });
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.layout.addPanel).toHaveBeenCalledOnce();
    expect(h.orchestrator.connectPanel).not.toHaveBeenCalled();
    expect(h.progress.update).not.toHaveBeenCalled();
    expect(h.progress.close).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores unrelated session exits and stops the remaining batch on Esc', async () => {
    const h = harness();
    h.progress.update.mockImplementation(() => { h.exit(7); h.progress.cancelled = true; });
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.layout.addPanel).toHaveBeenCalledOnce();
    expect(showErrorToast).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(h.app.screen, expect.stringContaining('Remaining launches cancelled'), 6000);
  });

  it.each(['limit', 'exception', 'ambiguous'])('cleans up a structural %s failure', async failure => {
    const h = harness();
    h.layout.addPanel.mockImplementation(async cwd => {
      if (failure === 'exception') throw new Error('Synthetic allocation failure');
      if (failure === 'ambiguous') h.panels.push(file(12, cwd), file(13, cwd));
      return failure !== 'limit';
    });
    await h.app.actionLaunchAgentBatch(h.choice());
    expect(h.manager.launchProfile).not.toHaveBeenCalled();
    expect(h.progress.close).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.app.destructiveTransitionInProgress).toBe(false);
    expect(showErrorToast).toHaveBeenCalled();
  });

  it('serializes overlapping batches', async () => {
    const h = harness();
    await Promise.all([h.app.actionLaunchAgentBatch(h.choice(1)), h.app.actionLaunchAgentBatch(h.choice(2))]);
    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(h.manager.launchProfile).toHaveBeenCalledOnce();
  });

  it('exposes batch capacity in F2 and dispatches the batch choice once', async () => {
    const h = harness();
    vi.mocked(showAgentDialog).mockResolvedValue(h.choice(1) as any);
    await h.app.actionLaunchAgent();
    expect(showAgentDialog).toHaveBeenCalledWith(h.app.screen, h.app.theme, [7, 2, 4], 7, {}, [], { maxNewPanels: 97, enableProtocolBatch: true });
    expect(h.manager.launchProfile).toHaveBeenCalledOnce();
  });
});
