import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentType } from '../../src/agents/types.js';
import type { ProtocolIssue } from '../../src/orchestration/protocol.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const harnesses = ['claude', 'codex', 'gemini', 'generic', 'opencode'] as const;
const otherCapability = 'b'.repeat(43);
const missingHeaderFeedback = [
  '[Commander protocol error] This frame was not sent.',
  'Missing closing === on the header.',
  'Rejected counters: 1.',
  'For a correction, use a fresh counter and put that same counter on the complete header and matching END footer. Keep the intended recipient and task unchanged.',
  'Do not resend other frames already acknowledged as delivered. Wait for Commander feedback after submitting your correction.',
  'Correction notice 1 of 3.',
].join(' ');

function fixture(agentType: AgentType = 'codex') {
  const tp = {
    panelIndex: 0, cols: 1200, isRunning: true, sessionGeneration: 1,
    inputGeneration: 0n, userInputGeneration: 0n, hasPendingUserInput: false, inputSynchronized: true,
    sendInput: vi.fn((_text: string) => true),
    getVisibleGridLines: vi.fn(() => [] as string[]),
    getProtocolSetupError: vi.fn(() => null),
    setProtocolCapability: vi.fn(),
    muteScanner: vi.fn(), unmuteScanner: vi.fn(),
    markProtocolTextAsProcessed: vi.fn(), reserveProtocolTextForEcho: vi.fn(),
    snapshotVisibleProtocolAsProcessed: vi.fn(), showCommanderActivity: vi.fn(),
    holdProtocolFeedback: vi.fn(),
    updatePanelIndex: vi.fn(), killAgent: vi.fn(),
    onCommanderMessage: null as any, onCommanderProtocolError: null as any, onUserInput: null as any,
  };
  const state = {
    terminal: tp as typeof tp | null,
    sessionId: 'synthetic-session-0',
    agentType,
    profileId: agentType === 'generic' ? 'pi-apex' : agentType as string,
  };
  const layout = {
    panelCount: 1,
    allPanels: [tp],
    hasPanel: vi.fn((panelIndex: number) => panelIndex === 0 && state.terminal !== null),
    getPanel: vi.fn((panelIndex: number) => panelIndex === 0 ? state.terminal : null),
    getTerminalPanel: vi.fn((panelIndex: number) => panelIndex === 0 ? state.terminal : null),
    setActivePanel: vi.fn(),
  };
  const agents = {
    getAgentType: vi.fn((panelIndex: number) => panelIndex === 0 ? state.agentType : null),
    getAgentProfileId: vi.fn((panelIndex: number) => panelIndex === 0 ? state.profileId : null),
    getAgentSessionId: vi.fn((panelIndex: number) => panelIndex === 0 ? state.sessionId : null),
    findPanelBySessionId: vi.fn((id: string) => id === state.sessionId ? 0 : null),
    getRunningAgents: vi.fn(() => [{ panelIndex: 0, sessionId: state.sessionId,
      type: state.agentType, name: 'Synthetic harness', status: 'running', uptime: 0 }]),
    onLifecycle: vi.fn(() => () => {}),
  };
  const orchestrator: any = new Orchestrator(layout as any, agents as any);
  // The test exercises explicit injection authorization, while provider startup,
  // prompt typing, and submit delay are irrelevant to correction callback scope.
  orchestrator.delay = vi.fn(async () => undefined);
  orchestrator.sendTextToAgent = vi.fn(async () => true);
  orchestrator.submitInput = vi.fn(async () => true);
  orchestrator.connectPanel(tp);
  return {
    tp, state, layout, agents, orchestrator,
    async arm() {
      expect(await orchestrator.injectProtocol(tp)).toBe(true);
      const capability = orchestrator.protocolCapabilities.get(state.sessionId) as string;
      expect(capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return capability;
    },
    issue(capability: string, code: ProtocolIssue['code'] = 'missing-header-delimiter'): ProtocolIssue {
      return { code, capability, sequences: [1], fingerprint: 'synthetic-fingerprint-1' };
    },
    blockInputLane() {
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      orchestrator.inputLaneTails.set(state.sessionId, blocked);
      return release;
    },
    async settle() {
      await Promise.all([...orchestrator.inputLaneTails.values()]);
      await Promise.resolve();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Orchestrator scoped model correction feedback', () => {
  it.each(harnesses)('%s receives a specific correction only after explicit protocol injection', async (harness) => {
    const f = fixture(harness);
    f.tp.onCommanderProtocolError(f.issue(otherCapability), 1);
    expect(f.tp.sendInput).not.toHaveBeenCalled();
    const capability = await f.arm();
    f.tp.onCommanderProtocolError(f.issue(capability), 1);
    await f.settle();
    expect(f.tp.sendInput).toHaveBeenCalledTimes(harness === 'claude' ? 2 : 1);
    const feedback = f.tp.sendInput.mock.calls[0][0];
    expect(feedback).toContain('[Commander protocol error]');
    expect(feedback).toMatch(/missing.*===.*header|header.*missing.*===/i);
    expect(feedback).toMatch(/fresh.*counter/i);
    expect(feedback).not.toContain(capability);
    expect(feedback).not.toContain('synthetic-fingerprint');
    expect(feedback).not.toContain('COMMANDER:SEND:'); // No executable repair/template echo.
    if (harness === 'claude') {
      expect(feedback).toBe(missingHeaderFeedback);
      expect(f.tp.sendInput).toHaveBeenLastCalledWith('\r');
    } else {
      expect(feedback).toBe(`\x1b[200~${missingHeaderFeedback}\x1b[201~`);
      expect(f.orchestrator.submitInput).toHaveBeenCalled();
    }
  });

  it('explains both absent closing delimiters and the stop boundary on the final notice', async () => {
    const f = fixture();
    const capability = await f.arm();
    f.tp.onCommanderProtocolError(f.issue(capability, 'missing-both-delimiters'), 3);
    await f.settle();
    const feedback = f.tp.sendInput.mock.calls[0][0];
    expect(feedback).toMatch(/header.*footer|footer.*header/i);
    expect(feedback).toContain('===');
    expect(feedback).toMatch(/stop|limit|last|final/i);
    expect(feedback).not.toContain(capability);
  });

  it.each(['wrong-capability', 'disarmed', 'session-replaced', 'generation-replaced', 'panel-replaced',
    'stopped', 'shutdown'] as const)('drops %s feedback at callback time', async (scenario) => {
    const f = fixture();
    const capability = await f.arm();
    const callback = f.tp.onCommanderProtocolError;
    const diagnostic = f.issue(capability);
    switch (scenario) {
      case 'wrong-capability': diagnostic.capability = otherCapability; break;
      case 'disarmed': f.orchestrator.protocolCapabilities.delete(f.state.sessionId); break;
      case 'session-replaced': f.state.sessionId = 'replacement-session'; break;
      case 'generation-replaced': f.tp.sessionGeneration += 1; break;
      case 'panel-replaced': f.state.terminal = { ...f.tp }; break;
      case 'stopped': f.tp.isRunning = false; break;
      case 'shutdown': await f.orchestrator.sealAndDrain(); break;
    }
    callback(diagnostic, 1);
    await f.settle();
    expect(f.tp.sendInput).not.toHaveBeenCalled();
  });

  it.each(['capability-rotated', 'user-typed', 'session-replaced', 'generation-replaced', 'stopped',
    'disconnected', 'shutdown'] as const)('drops queued feedback when %s before the input lane opens', async (scenario) => {
    const f = fixture();
    const capability = await f.arm();
    const release = f.blockInputLane();
    f.tp.onCommanderProtocolError(f.issue(capability), 1);
    expect(f.tp.sendInput).not.toHaveBeenCalled();
    switch (scenario) {
      case 'capability-rotated': f.orchestrator.protocolCapabilities.set(f.state.sessionId, otherCapability); break;
      case 'user-typed': f.tp.inputGeneration += 1n; f.tp.userInputGeneration += 1n; f.tp.onUserInput(); break;
      case 'session-replaced': f.state.sessionId = 'replacement-session'; break;
      case 'generation-replaced': f.tp.sessionGeneration += 1; break;
      case 'stopped': f.tp.isRunning = false; break;
      case 'disconnected': f.orchestrator.disconnectPanel(0); break;
      case 'shutdown': f.orchestrator.sealed = true; break;
    }
    release();
    await f.settle();
    expect(f.tp.sendInput).not.toHaveBeenCalled();
  });

  it('delivers queued feedback once when capability, session, and user input stay unchanged', async () => {
    const f = fixture();
    const capability = await f.arm();
    const release = f.blockInputLane();
    f.tp.onCommanderProtocolError(f.issue(capability), 1);
    expect(f.tp.sendInput).not.toHaveBeenCalled();
    release();
    await f.settle();
    expect(f.tp.sendInput).toHaveBeenCalledOnce();
  });

  it('does not let correction feedback overwrite an existing human prompt draft', async () => {
    const f = fixture();
    const capability = await f.arm();
    f.tp.hasPendingUserInput = true;
    f.tp.onCommanderProtocolError(f.issue(capability), 1);
    await f.settle();
    expect(f.tp.sendInput).not.toHaveBeenCalled();
    expect(f.tp.holdProtocolFeedback).toHaveBeenCalled();
  });

  it('keeps queued correction eligible after a programmatic ACK without new human input', async () => {
    const f = fixture();
    const capability = await f.arm();
    const release = f.blockInputLane();
    f.tp.onCommanderProtocolError(f.issue(capability), 1);
    f.tp.inputGeneration += 1n; // A controller-generated write, not a typed user draft.
    release();
    await f.settle();
    expect(f.tp.sendInput).toHaveBeenCalledOnce();
  });

  it.each(['user-typed', 'capability-rotated', 'generation-replaced'] as const)(
    'does not submit a Claude correction when %s during paste preparation', async (scenario) => {
      const f = fixture('claude');
      const capability = await f.arm();
      f.tp.cols = 80;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      f.orchestrator.sendTextToAgent = vi.fn(async (_panel, _text, stillValid) => {
        await pending;
        return stillValid();
      });
      f.orchestrator.submitInput.mockClear();
      f.tp.onCommanderProtocolError(f.issue(capability), 1);
      expect(f.orchestrator.sendTextToAgent).toHaveBeenCalledOnce();
      switch (scenario) {
        case 'user-typed': f.tp.userInputGeneration += 1n; f.tp.hasPendingUserInput = true; break;
        case 'capability-rotated': f.orchestrator.protocolCapabilities.set(f.state.sessionId, otherCapability); break;
        case 'generation-replaced': f.tp.sessionGeneration += 1; break;
      }
      release();
      await f.settle();
      expect(f.orchestrator.submitInput).not.toHaveBeenCalled();
      expect(f.tp.sendInput).not.toHaveBeenCalled();
    },
  );
});
