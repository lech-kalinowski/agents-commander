import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCENARIO } from '../../Example/apex-sixteen-panel/scenario.mjs';
import type { AgentLifecycleEvent } from '../../src/agents/agent-manager.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import { ProtocolScanner, type CommanderMessage } from '../../src/orchestration/protocol.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() },
}));

interface RoutingInternals {
  delay: () => Promise<void>;
  drainWork: Set<Promise<void>>;
  protocolCapabilities: Map<string, string>;
}

const fixtures: Orchestrator[] = [];
afterEach(async () => {
  for (const orchestrator of fixtures.splice(0)) {
    await orchestrator.sealAndDrain();
    orchestrator.resetState();
  }
});

/**
 * Real scanner, session authorization, input sequencing, routing, and ledger;
 * synthetic terminal endpoints only. No provider, model, PTY, or network is used.
 * Wave gates and role permissions are prompt instructions, not router policy:
 * this fixture deliberately emits the example's intended conversation graph.
 */
async function createShowcaseFixture(adapter: 'opencode' | 'generic') {
  const panels = SCENARIO.roles.map((role) => ({
    panelIndex: role.panel - 1,
    isRunning: true,
    cols: 200,
    sessionId: `synthetic-${role.id}-session-1`,
    profileId: role.id,
    name: `Synthetic ${role.label}`,
    sendInput: vi.fn((_text: string) => true),
    updatePanelIndex() {},
    reserveProtocolTextForEcho() {},
    showCommanderActivity() {},
    markProtocolTextAsProcessed() {},
    snapshotVisibleProtocolAsProcessed() {},
    onCommanderMessage: null as ((message: CommanderMessage) => void) | null,
    onUserInput: null as (() => void) | null,
  }));
  const layout = {
    panelCount: panels.length,
    allPanels: panels,
    hasPanel: (index: number) => Boolean(panels[index]),
    getPanel: (index: number) => panels[index] ?? null,
    getTerminalPanel: (index: number) => panels[index] ?? null,
    convertToTerminal: (index: number) => panels[index] ?? null,
    setActivePanel() {},
  };
  let onLifecycle: ((event: AgentLifecycleEvent) => void) | undefined;
  const agents = {
    getAgentType: (index: number) => panels[index] ? adapter : null,
    getAgentProfileId: (index: number) => panels[index]?.profileId ?? null,
    getAgentSessionId: (index: number) => panels[index]?.sessionId ?? null,
    getRunningAgents: () => panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      sessionId: panel.sessionId,
      type: adapter,
      name: panel.name,
      profileId: panel.profileId,
      status: 'running',
      uptime: 0,
    })),
    findPanelBySessionId: (sessionId: string) => panels.find((panel) => panel.sessionId === sessionId)?.panelIndex ?? null,
    onLifecycle: (listener: (event: AgentLifecycleEvent) => void) => { onLifecycle = listener; },
  };
  const orchestrator = new Orchestrator(layout as never, agents as never);
  fixtures.push(orchestrator);
  const internals = orchestrator as unknown as RoutingInternals;
  // Preserve real input sequencing; synthetic endpoints have no UI-readiness delay.
  internals.delay = async () => {};
  const keyFor = (panelNumber: number) => {
    const key = internals.protocolCapabilities.get(panels[panelNumber - 1].sessionId);
    if (!key) throw new Error(`P${panelNumber} has no current protocol capability`);
    return key;
  };
  for (const panel of panels) {
    orchestrator.connectPanel(panel as never);
    // External harness profiles cannot use the internal demo authorization path.
    expect(orchestrator.armInternalProtocol(panel as never, 'x'.repeat(43))).toBe(false);
    expect(await orchestrator.injectProtocol(panel as never)).toBe(true);
    expect(keyFor(panel.panelIndex + 1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    panel.sendInput.mockClear();
  }
  expect(new Set(panels.map((panel) => keyFor(panel.panelIndex + 1))).size).toBe(16);

  const scanners = panels.map((panel) => new ProtocolScanner(
    panel.panelIndex, panel.name, (message) => panel.onCommanderMessage?.(message),
  ));
  const settle = async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (internals.drainWork.size === 0) return;
    }
    throw new Error('Synthetic sixteen-panel routing did not settle');
  };
  const emit = (verb: 'send' | 'reply', source: number, content: string, target?: number, capability = keyFor(source)) => {
    if (verb === 'send' && target === undefined) throw new Error('SEND needs an explicit stable panel ID');
    const route = verb === 'send' ? `:${adapter}:${target}` : '';
    const wire = `===COMMANDER:${verb.toUpperCase()}${route}:${capability}===\n${content}\n===COMMANDER:END:${capability}===\n`;
    // Observe a genuinely streamed frame, including splits inside both markers.
    const endSplit = wire.lastIndexOf('===COMMANDER:END:') + 13;
    scanners[source - 1].feed(wire.slice(0, 19));
    scanners[source - 1].feed(wire.slice(19, endSplit));
    scanners[source - 1].feed(wire.slice(endSplit));
  };
  const restart = (panelNumber: number) => {
    const panel = panels[panelNumber - 1];
    const previousSessionId = panel.sessionId;
    panel.sessionId = `${previousSessionId}-restarted`;
    if (!onLifecycle) throw new Error('Orchestrator did not subscribe to lifecycle events');
    onLifecycle({
      type: 'restarted', panelIndex: panel.panelIndex,
      sessionId: panel.sessionId, previousSessionId,
      agentType: adapter, agentName: panel.name,
      profileId: panel.profileId, profileLabel: panel.name,
    });
  };

  // This only models explicit user engagement; it does not enforce START/CONTINUE gates.
  panels[0].onUserInput!();
  return { orchestrator, panels, keyFor, emit, settle, restart };
}

describe.each([
  { harness: 'OpenCode', adapter: 'opencode' as const },
  { harness: 'Pi', adapter: 'generic' as const },
])('sixteen-panel APEX example via $harness/$adapter (synthetic endpoints)', ({ adapter }) => {
  it('routes all seven waves with fifteen SEND/REPLY pairs, even when workers finish in reverse order', async () => {
    expect(SCENARIO.roles.map((role) => role.panel)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(SCENARIO.waves).toEqual([[2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13], [14], [15], [16]]);
    const fixture = await createShowcaseFixture(adapter);
    const { orchestrator, panels, emit, settle } = fixture;
    const expectedTaskBodies = new Map<number, string>();
    const expectedReplyBodies = new Map<number, string>();
    const priorFindings: string[] = [];
    let completedWorkers = 0;

    for (const [waveIndex, workers] of SCENARIO.waves.entries()) {
      for (const worker of workers) {
        const role = SCENARIO.roles[worker - 1];
        expect(role.wave).toBe(waveIndex + 1);
        const task = `Synthetic wave ${waveIndex + 1}, ${role.role}.\n${role.mission}\nPrior evidence: ${priorFindings.join('; ') || 'none; first wave'}`;
        expectedTaskBodies.set(worker, task);
        emit('send', 1, task, worker);
      }
      await settle();
      const dispatched = orchestrator.getRecentActivity(100);
      expect(dispatched).toHaveLength(completedWorkers * 2 + workers.length);
      expect(dispatched.every((record) => record.status === 'delivered')).toBe(true);

      for (const worker of [...workers].reverse()) {
        const reply = `Synthetic P${worker} evidence for wave ${waveIndex + 1}; proposed checks only, not executed tests.`;
        expectedReplyBodies.set(worker, reply);
        priorFindings.push(reply);
        emit('reply', worker, reply);
      }
      // Replies share P1's actual serialized input lane; do not serialize them in the fixture.
      await settle();
      completedWorkers += workers.length;
      expect(orchestrator.getRecentActivity(100)).toHaveLength(completedWorkers * 2);
    }

    expect(await orchestrator.sealAndDrain()).toBe(true);
    const records = orchestrator.getRecentActivity(100);
    expect(records).toHaveLength(30);
    expect(records.every((record) => record.status === 'delivered')).toBe(true);
    expect(new Set(records.map((record) => record.messageId)).size).toBe(30);
    const sends = records.filter((record) => record.kind === 'send');
    const replies = records.filter((record) => record.kind === 'reply');
    expect(sends).toHaveLength(15);
    expect(replies).toHaveLength(15);
    expect(new Set(sends.map((record) => record.threadId)).size).toBe(15);
    expect(records.some((record) => record.kind === 'broadcast')).toBe(false);
    expect(sends.every((record) => record.source.panelIndex === 0)).toBe(true);
    expect(replies.every((record) => record.source.panelIndex !== 0 && record.target.panelIndex === 0)).toBe(true);

    for (const role of SCENARIO.roles.slice(1)) {
      const workerIndex = role.panel - 1;
      const task = sends.find((record) => record.target.panelIndex === workerIndex)!;
      const reply = replies.find((record) => record.source.panelIndex === workerIndex)!;
      expect(task).toMatchObject({
        source: { sessionId: panels[0].sessionId, agentType: adapter },
        target: { sessionId: panels[workerIndex].sessionId, agentType: adapter },
        content: expectedTaskBodies.get(role.panel), replyToMessageId: null,
      });
      expect(reply).toMatchObject({
        source: { sessionId: panels[workerIndex].sessionId, agentType: adapter },
        target: { sessionId: panels[0].sessionId, agentType: adapter },
        content: expectedReplyBodies.get(role.panel),
        threadId: task.threadId, replyToMessageId: task.messageId,
      });
      expect(panels[workerIndex].sendInput.mock.calls.map(([text]) => text).join(''))
        .toContain(expectedTaskBodies.get(role.panel));
      expect(panels[0].sendInput.mock.calls.map(([text]) => text).join(''))
        .toContain(expectedReplyBodies.get(role.panel));
    }
  });

  it('rejects another panel’s capability without consuming the legitimate worker reply window', async () => {
    const { orchestrator, panels, keyFor, emit, settle } = await createShowcaseFixture(adapter);
    emit('send', 1, 'Invalid coordinator capability', 2, keyFor(3));
    await settle();
    expect(orchestrator.getRecentActivity(100)).toEqual([]);
    expect(panels.every((panel) => panel.sendInput.mock.calls.length === 0)).toBe(true);

    emit('send', 1, 'Legitimate coordinator task', 2);
    await settle();
    const task = orchestrator.getRecentActivity(100)[0];
    expect(task).toMatchObject({ kind: 'send', status: 'delivered' });
    panels[0].sendInput.mockClear();
    emit('reply', 2, 'Invalid worker capability', undefined, keyFor(3));
    await settle();
    expect(orchestrator.getRecentActivity(100)).toHaveLength(1);
    expect(panels[0].sendInput).not.toHaveBeenCalled();

    emit('reply', 2, 'Legitimate worker reply');
    await settle();
    expect(orchestrator.getRecentActivity(100)).toHaveLength(2);
    expect(orchestrator.getRecentActivity(100)[0]).toMatchObject({
      kind: 'reply', status: 'delivered',
      threadId: task.threadId, replyToMessageId: task.messageId,
      target: { panelIndex: 0, sessionId: panels[0].sessionId },
    });
  });

  it('invalidates a restarted worker’s old capability and reply window before accepting a fresh exchange', async () => {
    const { orchestrator, panels, keyFor, emit, settle, restart } = await createShowcaseFixture(adapter);
    emit('send', 1, 'Task issued before the P16 restart', 16);
    await settle();
    const oldTask = orchestrator.getRecentActivity(100)[0];
    const oldCapability = keyFor(16);
    const oldSession = panels[15].sessionId;
    restart(16);
    emit('reply', 16, 'Stale output before reinjection', undefined, oldCapability);
    await settle();
    expect(orchestrator.getRecentActivity(100)).toHaveLength(1);

    expect(await orchestrator.injectProtocol(panels[15] as never)).toBe(true);
    expect(keyFor(16)).not.toBe(oldCapability);
    panels[0].sendInput.mockClear();
    emit('reply', 16, 'Stale output after reinjection', undefined, oldCapability);
    emit('reply', 16, 'New session cannot inherit an old reply window');
    await settle();
    expect(orchestrator.getRecentActivity(100)).toHaveLength(1);
    expect(panels[0].sendInput).not.toHaveBeenCalled();

    emit('send', 1, 'Explicit new task for the restarted final verifier', 16);
    await settle();
    const newTask = orchestrator.getRecentActivity(100)[0];
    expect(newTask.threadId).not.toBe(oldTask.threadId);
    expect(newTask.target.sessionId).not.toBe(oldSession);
    emit('reply', 16, 'Fresh final-verifier reply');
    await settle();
    expect(orchestrator.getRecentActivity(100)).toHaveLength(3);
    expect(orchestrator.getRecentActivity(100)[0]).toMatchObject({
      kind: 'reply', status: 'delivered',
      source: { panelIndex: 15, sessionId: panels[15].sessionId },
      target: { panelIndex: 0, sessionId: panels[0].sessionId },
      threadId: newTask.threadId, replyToMessageId: newTask.messageId,
    });
  });
});
