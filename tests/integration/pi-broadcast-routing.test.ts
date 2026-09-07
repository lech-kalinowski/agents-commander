import { afterEach, describe, expect, it, vi } from 'vitest';
import { PI_BROADCAST_BODY, PI_BROADCAST_SCENARIO } from '../../Example/apex-sixteen-panel/broadcast-scenario.mjs';
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
 * Real scanner, session authorization, routing, input sequencing, and ledger;
 * synthetic generic/Pi terminal endpoints only. No provider or model is used.
 * Human-start and plain-receipt rules are example prompt instructions, not router
 * policy. BROADCAST reaches every other connected agent; this fixture has two.
 */
async function createBroadcastFixture() {
  const panels = PI_BROADCAST_SCENARIO.roles.map((role) => ({
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
  const agents = {
    getAgentType: (index: number) => panels[index] ? 'generic' : null,
    getAgentProfileId: (index: number) => panels[index]?.profileId ?? null,
    getAgentSessionId: (index: number) => panels[index]?.sessionId ?? null,
    getRunningAgents: () => panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      sessionId: panel.sessionId,
      type: 'generic',
      name: panel.name,
      profileId: panel.profileId,
      status: 'running',
      uptime: 0,
    })),
    findPanelBySessionId: (sessionId: string) => panels.find((panel) => panel.sessionId === sessionId)?.panelIndex ?? null,
    onLifecycle() {},
  };
  const orchestrator = new Orchestrator(layout as never, agents as never);
  fixtures.push(orchestrator);
  const internals = orchestrator as unknown as RoutingInternals;
  // Keep real input sequencing without readiness waits for synthetic terminals.
  internals.delay = async () => {};
  const keyFor = (panelNumber: number) => {
    const key = internals.protocolCapabilities.get(panels[panelNumber - 1].sessionId);
    if (!key) throw new Error(`P${panelNumber} has no current protocol capability`);
    return key;
  };
  for (const panel of panels) {
    orchestrator.connectPanel(panel as never);
    expect(orchestrator.armInternalProtocol(panel as never, 'x'.repeat(43))).toBe(false);
    expect(await orchestrator.injectProtocol(panel as never)).toBe(true);
    expect(keyFor(panel.panelIndex + 1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    panel.sendInput.mockClear();
  }
  expect(new Set(panels.map((panel) => keyFor(panel.panelIndex + 1))).size).toBe(3);
  const scanners = panels.map((panel) => new ProtocolScanner(
    panel.panelIndex, panel.name, (message) => panel.onCommanderMessage?.(message),
  ));
  const settle = async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (internals.drainWork.size === 0) return;
    }
    throw new Error('Synthetic Pi broadcast routing did not settle');
  };
  const inputsFor = (panelNumber: number) => panels[panelNumber - 1].sendInput.mock.calls
    .map(([text]) => text).join('');
  const frame = (capability = keyFor(1)) => (
    `===COMMANDER:BROADCAST:${capability}===\n${PI_BROADCAST_BODY}\n===COMMANDER:END:${capability}===\n`
  );

  // Models the user's explicit engagement, not enforcement of a prompt keyword.
  panels[0].onUserInput!();
  return { orchestrator, panels, scanners, keyFor, settle, inputsFor, frame };
}

describe('Pi/APEX three-panel broadcast example (synthetic endpoints)', () => {
  it('routes only the complete frame, once per peer, preserving body and recipient thread metadata', async () => {
    expect(PI_BROADCAST_SCENARIO.roles.map((role) => role.panel)).toEqual([1, 2, 3]);
    expect(PI_BROADCAST_SCENARIO.broadcastBody).toBe(PI_BROADCAST_BODY);
    const { orchestrator, panels, scanners, settle, inputsFor, frame } = await createBroadcastFixture();
    const wire = frame();
    const endSplit = wire.lastIndexOf('===COMMANDER:END:') + 13;
    scanners[0].feed(wire.slice(0, 19));
    scanners[0].feed(wire.slice(19, endSplit));
    await settle();
    expect(orchestrator.getRecentActivity(100)).toEqual([]);
    expect(panels.every((panel) => panel.sendInput.mock.calls.length === 0)).toBe(true);

    scanners[0].feed(wire.slice(endSplit));
    await settle();
    const records = orchestrator.getRecentActivity(100);
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.messageId)).size).toBe(2);
    // Commander opens independent threads for the broadcast's two recipients.
    expect(new Set(records.map((record) => record.threadId)).size).toBe(2);
    expect(records.map((record) => record.target.panelIndex).sort()).toEqual([1, 2]);
    for (const receiverNumber of [2, 3]) {
      const receiver = panels[receiverNumber - 1];
      const record = records.find((entry) => entry.target.panelIndex === receiver.panelIndex)!;
      expect(record).toMatchObject({
        kind: 'broadcast', status: 'delivered', content: PI_BROADCAST_BODY,
        source: { panelIndex: 0, sessionId: panels[0].sessionId, agentType: 'generic' },
        target: { panelIndex: receiver.panelIndex, sessionId: receiver.sessionId, agentType: 'generic' },
        replyToMessageId: null,
      });
      const delivered = inputsFor(receiverNumber);
      expect(delivered).toContain(
        `[Broadcast from ${panels[0].name} in Panel 1 | thread=${record.threadId} | msg=${record.messageId}]: ${PI_BROADCAST_BODY}`,
      );
      expect(delivered.split(PI_BROADCAST_BODY)).toHaveLength(2);
    }
    expect(inputsFor(1)).toContain('[Commander ACK] kind=broadcast queued=2');
    expect(inputsFor(1)).not.toContain(PI_BROADCAST_BODY);

    // Terminal echo of the ACK and the example's local receipts are not frames.
    const inputCounts = panels.map((panel) => panel.sendInput.mock.calls.length);
    scanners[0].feed(`${inputsFor(1)}\n`);
    scanners[1].feed('APEX_BROADCAST_RECEIVED P2\n');
    scanners[2].feed('APEX_BROADCAST_RECEIVED P3\n');
    // A later harness length-limit error must not cause automatic retransmission.
    scanners[0].feed('The response was truncated before completion.\n');
    await settle();
    expect(await orchestrator.sealAndDrain()).toBe(true);
    expect(orchestrator.getRecentActivity(100)).toEqual(records);
    expect(panels.map((panel) => panel.sendInput.mock.calls.length)).toEqual(inputCounts);
  });

  it('never routes a truncated broadcast body without its complete END marker', async () => {
    const { orchestrator, panels, scanners, keyFor, settle } = await createBroadcastFixture();
    const partialBody = PI_BROADCAST_BODY.slice(0, Math.floor(PI_BROADCAST_BODY.length / 2));
    scanners[0].feed(`===COMMANDER:BROADCAST:${keyFor(1)}===\n${partialBody}`);
    await settle();
    expect(orchestrator.getRecentActivity(100)).toEqual([]);
    expect(panels.every((panel) => panel.sendInput.mock.calls.length === 0)).toBe(true);

    scanners[0].feed('\nThe response was truncated before completion.\n');
    await settle();
    expect(await orchestrator.sealAndDrain()).toBe(true);
    expect(orchestrator.getRecentActivity(100)).toEqual([]);
    expect(panels.every((panel) => panel.sendInput.mock.calls.length === 0)).toBe(true);
  });

  it('rejects a different panel capability before accepting one complete current-capability broadcast', async () => {
    const { orchestrator, panels, scanners, keyFor, settle, frame, inputsFor } = await createBroadcastFixture();
    scanners[0].feed(frame(keyFor(2)));
    await settle();
    expect(orchestrator.getRecentActivity(100)).toEqual([]);
    expect(panels.every((panel) => panel.sendInput.mock.calls.length === 0)).toBe(true);

    scanners[0].feed(frame());
    await settle();
    expect(orchestrator.getRecentActivity(100)).toHaveLength(2);
    for (const receiverNumber of [2, 3]) {
      expect(inputsFor(receiverNumber).split(PI_BROADCAST_BODY)).toHaveLength(2);
    }
  });
});
