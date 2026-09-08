import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/screen/dialog/agent-dialog.js', () => ({ showAgentDialog: vi.fn() }));
vi.mock('../../src/screen/dialog/protocol-batch-dialog.js', () => ({ showProtocolBatchDialog: vi.fn() }));
vi.mock('../../src/screen/dialog/protocol-batch-progress.js', () => ({ showProtocolBatchProgress: vi.fn() }));
vi.mock('../../src/screen/dialog/confirm-dialog.js', () => ({ showConfirmDialog: vi.fn() }));
vi.mock('../../src/screen/toast.js', () => ({ showToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('../../src/utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { App } from '../../src/app.js';
import { showAgentDialog } from '../../src/screen/dialog/agent-dialog.js';
import { showProtocolBatchDialog } from '../../src/screen/dialog/protocol-batch-dialog.js';
import { showProtocolBatchProgress } from '../../src/screen/dialog/protocol-batch-progress.js';
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { showErrorToast, showToast } from '../../src/screen/toast.js';
import type { ProtocolInjectionOutcome, ProtocolInjectionTarget } from '../../src/orchestration/orchestrator.js';

function harness(count = 16) {
  const targets = Array.from({ length: count }, (_, i) => Object.freeze({
    panelIndex: i * 2 + 3, terminal: { isRunning: true },
    sessionId: `session-${i}`, agentType: 'generic', profileId: 'apex-pi',
    name: `APEX ${i + 1}`, armed: false,
  })) as unknown as ProtocolInjectionTarget[];
  const progress = { cancelled: false, update: vi.fn(), close: vi.fn() };
  vi.mocked(showProtocolBatchProgress).mockReturnValue(progress);
  vi.mocked(showProtocolBatchDialog).mockResolvedValue(targets.map(t => t.panelIndex));
  const orchestrator = {
    getProtocolInjectionTargets: vi.fn(() => targets),
    injectProtocolTarget: vi.fn(async (_target: ProtocolInjectionTarget,
      _options?: { skipIfArmed?: boolean; shouldCancel?: () => boolean }): Promise<ProtocolInjectionOutcome> => 'submitted'),
    injectProtocol: vi.fn(), sendTask: vi.fn(),
  };
  const layout = {
    workspacePanelIds: targets.map(t => t.panelIndex), activePanel: { panelIndex: 3 },
    availablePanelCapacity: 100 - count, addPanel: vi.fn(), convertToTerminal: vi.fn(),
    removePanel: vi.fn(), setActivePanel: vi.fn(),
  };
  const agentManager = { launchProfile: vi.fn(), killAgent: vi.fn() };
  const app: any = Object.assign(Object.create(App.prototype), {
    orchestrator, layout, agentManager, screen: { render: vi.fn() }, theme: {},
    config: { agents: {}, agentProfiles: [] }, updateStatus: vi.fn(),
    disposalStarted: false, destructiveTransitionInProgress: false,
  });
  return { app, orchestrator, targets, progress, layout, agentManager };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(showConfirmDialog).mockResolvedValue(true);
});

describe('explicit bulk protocol injection', () => {
  it('routes F2/P to protocol selection, without selecting or launching a profile', async () => {
    const h = harness(2);
    vi.mocked(showAgentDialog).mockResolvedValue({ action: 'protocol-batch' });
    await h.app.actionLaunchAgent();
    expect(showAgentDialog).toHaveBeenCalledWith(h.app.screen, h.app.theme,
      h.layout.workspacePanelIds, 3, {}, [], { maxNewPanels: 98, enableProtocolBatch: true });
    expect(showProtocolBatchDialog).toHaveBeenCalledOnce();
    expect(h.orchestrator.injectProtocolTarget).toHaveBeenCalledTimes(2);
    expect(h.agentManager.launchProfile).not.toHaveBeenCalled();
  });

  it.each([1, 16, 20, 100])('injects %i exact snapshots after one confirmation, with no launch/task side effects', async count => {
    const h = harness(count);
    await h.app.actionInjectProtocolBatch();
    expect(h.orchestrator.getProtocolInjectionTargets).toHaveBeenCalledOnce();
    expect(showConfirmDialog).toHaveBeenCalledOnce();
    expect(showConfirmDialog).toHaveBeenCalledWith(h.app.screen, h.app.theme,
      'Enable Commander Protocol', expect.stringContaining('empty, ready prompt'));
    const choices = vi.mocked(showProtocolBatchDialog).mock.calls[0][2];
    expect(choices[0]).toEqual({ panelIndex: 3, name: 'APEX 1', profileId: 'apex-pi', armed: false });
    expect(choices[0]).not.toHaveProperty('sessionId');
    expect(choices[0]).not.toHaveProperty('terminal');
    expect(h.orchestrator.injectProtocolTarget).toHaveBeenCalledTimes(count);
    expect(h.progress.update).toHaveBeenNthCalledWith(1, 0, 0, 0, 0, 3);
    h.orchestrator.injectProtocolTarget.mock.calls.forEach(([target, options], i) => {
      expect(target).toBe(h.targets[i]);
      expect(options?.skipIfArmed).toBe(true);
      expect(options?.shouldCancel?.()).toBe(false);
    });
    expect(h.progress.update).toHaveBeenLastCalledWith(count, count, 0, 0);
    expect(h.progress.close).toHaveBeenCalledOnce();
    expect(h.app.destructiveTransitionInProgress).toBe(false);
    for (const operation of [h.layout.addPanel, h.layout.convertToTerminal, h.layout.removePanel,
      h.layout.setActivePanel, h.agentManager.launchProfile, h.agentManager.killAgent,
      h.orchestrator.sendTask, h.orchestrator.injectProtocol]) expect(operation).not.toHaveBeenCalled();
  });

  it('deduplicates a subset and retains the original snapshots after the selection dialog', async () => {
    const h = harness(3);
    vi.mocked(showProtocolBatchDialog).mockResolvedValue([7, 3, 7]);
    vi.mocked(showConfirmDialog).mockImplementation(async () => {
      h.orchestrator.getProtocolInjectionTargets.mockReturnValue([]);
      return true;
    });
    await h.app.actionInjectProtocolBatch();
    expect(h.orchestrator.getProtocolInjectionTargets).toHaveBeenCalledOnce();
    expect(h.orchestrator.injectProtocolTarget.mock.calls.map(([t]) => t)).toEqual([h.targets[0], h.targets[2]]);
  });

  it.each([null, [], [999], [3, 999]])('does not inject a cancelled/invalid selection %j', async selected => {
    const h = harness();
    vi.mocked(showProtocolBatchDialog).mockResolvedValue(selected);
    await h.app.actionInjectProtocolBatch();
    expect(showConfirmDialog).not.toHaveBeenCalled();
    expect(h.orchestrator.injectProtocolTarget).not.toHaveBeenCalled();
    expect(h.app.destructiveTransitionInProgress).toBe(false);
  });

  it('does not open a picker when no eligible agents exist', async () => {
    const h = harness(0);
    await h.app.actionInjectProtocolBatch();
    expect(showProtocolBatchDialog).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith(h.app.screen, expect.stringContaining('Shell and demo roles are excluded'));
  });

  it('respects No and shutdown during confirmation', async () => {
    for (const shutdown of [false, true]) {
      const h = harness(2);
      vi.mocked(showConfirmDialog).mockImplementation(async () => { h.app.disposalStarted = shutdown; return shutdown; });
      await h.app.actionInjectProtocolBatch();
      expect(h.orchestrator.injectProtocolTarget).not.toHaveBeenCalled();
    }
  });

  it('continues after failed/stale sessions and reports skipped armed sessions', async () => {
    const h = harness(4);
    h.orchestrator.injectProtocolTarget.mockResolvedValueOnce('failed').mockResolvedValueOnce('stale')
      .mockResolvedValueOnce('already-armed').mockResolvedValueOnce('submitted');
    await h.app.actionInjectProtocolBatch();
    expect(h.progress.update).toHaveBeenLastCalledWith(4, 1, 1, 2);
    expect(showErrorToast).toHaveBeenCalledWith(h.app.screen,
      expect.stringContaining('1 submitted, 1 already enabled, 2 failed/changed, 0 not started'), 8000);
    expect(showErrorToast).toHaveBeenCalledWith(h.app.screen, expect.stringContaining('Inspect P4, P6.'), 8000);
  });

  it.each(['escape', 'shutdown'])('stops after an in-flight operation settles on %s', async reason => {
    const h = harness(3);
    h.orchestrator.injectProtocolTarget.mockImplementationOnce(async (_target, options) => {
      expect(options?.shouldCancel?.()).toBe(false);
      if (reason === 'escape') h.progress.cancelled = true;
      else h.app.disposalStarted = true;
      expect(options?.shouldCancel?.()).toBe(true);
      return 'submitted';
    });
    await h.app.actionInjectProtocolBatch();
    expect(h.orchestrator.injectProtocolTarget).toHaveBeenCalledOnce();
    expect(h.progress.close).toHaveBeenCalledOnce();
    expect(h.app.destructiveTransitionInProgress).toBe(false);
    if (reason === 'escape') expect(showToast).toHaveBeenCalledWith(h.app.screen,
      expect.stringContaining('2 not started'), 8000);
  });

  it('stops on queued cancellation without counting a submission', async () => {
    const h = harness(3);
    h.orchestrator.injectProtocolTarget.mockResolvedValueOnce('cancelled');
    await h.app.actionInjectProtocolBatch();
    expect(h.orchestrator.injectProtocolTarget).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith(h.app.screen, expect.stringContaining('0 submitted'), 8000);
  });

  it('closes progress and releases action ownership on unexpected injection errors', async () => {
    const h = harness(3);
    h.orchestrator.injectProtocolTarget.mockRejectedValueOnce(new Error('synthetic failure'));
    await h.app.actionInjectProtocolBatch();
    expect(h.progress.close).toHaveBeenCalledOnce();
    expect(h.app.destructiveTransitionInProgress).toBe(false);
    expect(showErrorToast).toHaveBeenCalledWith(h.app.screen, expect.stringContaining('Batch interrupted'), 8000);
  });

  it('rejects a second batch while the first owns the action lock', async () => {
    const h = harness();
    h.app.destructiveTransitionInProgress = true;
    await h.app.actionInjectProtocolBatch();
    expect(showProtocolBatchDialog).not.toHaveBeenCalled();
    expect(h.orchestrator.injectProtocolTarget).not.toHaveBeenCalled();
  });
});
