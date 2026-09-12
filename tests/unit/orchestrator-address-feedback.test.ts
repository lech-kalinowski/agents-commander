import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentType } from '../../src/agents/types.js';
import type { CaptureInput, CaptureSink } from '../../src/capture/types.js';
import type { ProtocolEvent } from '../../src/orchestration/protocol.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function fixture() {
  vi.useFakeTimers();
  const types: AgentType[] = ['opencode', 'opencode', 'claude', 'codex'];
  const names = ['OpenCode (APEX)', 'OpenCode (APEX)', 'Claude Code', 'Codex CLI'];
  const events: CaptureInput[] = [];
  const panels = types.map((type, panelIndex) => ({
    panelIndex, type, name: names[panelIndex], isRunning: true, cols: 32,
    sessionId: `session-${panelIndex}`, profileId: type,
    sessionGeneration: 1, inputGeneration: 0n, inputSynchronized: true,
    sendInput: vi.fn((_text: string) => true), killAgent: vi.fn(),
    updatePanelIndex: vi.fn(), markProtocolTextAsProcessed: vi.fn(),
    reserveProtocolTextForEcho: vi.fn(), snapshotVisibleProtocolAsProcessed: vi.fn(),
    showCommanderActivity: vi.fn(), onCommanderMessage: null as ((msg: ProtocolEvent) => void) | null,
    onUserInput: null as (() => void) | null,
  }));
  const layout = {
    allPanels: [...panels].reverse(), panelCount: panels.length,
    hasPanel: (id: number) => Boolean(panels[id]),
    getPanel: (id: number) => panels[id] ?? null,
    getTerminalPanel: (id: number) => panels[id] ?? null,
    convertToTerminal: vi.fn((id: number) => panels[id]),
    setActivePanel: vi.fn(), addPanel: vi.fn(),
  };
  const manager = {
    getAgentType: (id: number) => panels[id]?.type ?? null,
    getAgentProfileId: (id: number) => panels[id]?.profileId ?? null,
    getAgentSessionId: (id: number) => panels[id]?.sessionId ?? null,
    getRunningAgents: () => panels.filter(panel => panel.isRunning).map(panel => ({
      panelIndex: panel.panelIndex, sessionId: panel.sessionId, profileId: panel.profileId,
      name: panel.name, type: panel.type, status: 'running', uptime: 0,
    })),
    findPanelBySessionId: (id: string) => panels.find(panel => panel.sessionId === id)?.panelIndex ?? null,
    launchAgent: vi.fn(), killAgent: vi.fn(), onLifecycle: vi.fn(),
  };
  const sink: CaptureSink = {
    mode: 'protocol', record: event => { events.push(structuredClone(event)); },
    bindCapability: vi.fn(() => 'cap_1'), capabilityRef: () => 'cap_1',
    markIncomplete: vi.fn(), close: vi.fn(async () => {}),
    snapshot: () => ({ mode: 'protocol', state: 'recording', events: events.length, bytes: 0, pendingBytes: 0 }),
  };
  const orchestrator = new Orchestrator(layout as never, manager as never, undefined,
    { orchestration: { gridScanDelay: 0, claudeSubmitDelay: 0 } } as never, sink);
  const internals = orchestrator as any;
  panels.forEach(panel => {
    orchestrator.connectPanel(panel as never);
    internals.protocolInjected.add(panel.panelIndex);
    internals.protocolCapabilities.set(panel.sessionId, String.fromCharCode(65 + panel.panelIndex).repeat(43));
  });
  function emit(source: number, fields: Partial<ProtocolEvent> = {}) {
    const msg = {
      type: 'send', sourcePanel: source, sourceAgent: panels[source].name,
      targetAgent: 'opencode', targetPanel: 1, content: 'hello from the sender',
      capability: String.fromCharCode(65 + source).repeat(43), sequence: 1, ...fields,
    } as ProtocolEvent;
    panels[source].onCommanderMessage!(msg);
  }
  const input = (id: number) => panels[id].sendInput.mock.calls.map(([text]) => text).join('');
  return { panels, layout, manager, events, orchestrator, internals, emit, input };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('exact addresses and complete controller feedback', () => {
  it('returns an actionable authenticated unknown-model error without accepting or routing the body', async () => {
    const f = fixture();
    f.emit(0, { targetAgent: 'apex', rejection: 'unknown_agent_type', content: 'PRIVATE_REJECTED_BODY' });
    await vi.runAllTimersAsync();
    expect(f.input(0)).toContain('[CommanderError] Unknown SEND type "apex"');
    expect(f.input(0)).toContain('SEND address opencode:2');
    expect(f.input(0)).toContain('QUERY agents');
    expect(f.input(0)).toContain('new counter');
    expect(f.input(0)).not.toContain('PRIVATE_REJECTED_BODY');
    expect(f.panels[0].sendInput).toHaveBeenCalledOnce();
    f.panels.slice(1).forEach(panel => expect(panel.sendInput).not.toHaveBeenCalled());
    expect(f.layout.convertToTerminal).not.toHaveBeenCalled();
    expect(f.manager.launchAgent).not.toHaveBeenCalled();
    expect(f.manager.killAgent).not.toHaveBeenCalled();
    expect(f.orchestrator.getRecentActivity()).toEqual([]);
    expect(f.events.some(event => event.type === 'frame.accepted' || event.type === 'route.delivered')).toBe(false);
    expect(f.events.find(event => event.type === 'frame.rejected')).toMatchObject({ reason: 'unknown_agent_type', verb: 'send' });
    expect(JSON.stringify(f.events)).not.toContain('PRIVATE_REJECTED_BODY');
  });

  it('does not send unknown-type feedback for an unauthorized or unarmed source', async () => {
    const f = fixture();
    f.emit(0, { targetAgent: 'apex', rejection: 'unknown_agent_type', capability: 'X'.repeat(43) });
    f.internals.protocolInjected.delete(0);
    f.emit(0, { targetAgent: 'apex', rejection: 'unknown_agent_type' });
    await vi.runAllTimersAsync();
    f.panels.forEach(panel => expect(panel.sendInput).not.toHaveBeenCalled());
    expect(f.events.map(event => event.reason)).toEqual(['unauthorized', 'unauthorized']);
  });

  it('keeps the full wrong-address error for narrow Claude panels without replacing OpenCode or rerouting to Codex', async () => {
    const f = fixture();
    f.emit(2, { targetAgent: 'codex', targetPanel: 1 });
    await vi.runAllTimersAsync();
    expect(f.input(2)).toContain('status=failed');
    expect(f.input(2)).toContain('Current SEND address is opencode:2');
    expect(f.input(2)).toContain('new counter for a corrected message');
    expect(f.input(2)).toContain('\x1b[200~');
    expect(f.input(2)).toMatch(/\x1b\[201~\r$/u);
    [0, 1, 3].forEach(id => expect(f.panels[id].sendInput).not.toHaveBeenCalled());
    expect(f.layout.convertToTerminal).not.toHaveBeenCalled();
    expect(f.manager.launchAgent).not.toHaveBeenCalled();
    expect(f.manager.killAgent).not.toHaveBeenCalled();
    expect(f.orchestrator.getRecentActivity()[0].status).toBe('failed');
    expect(f.events.find(event => event.type === 'controller.feedback')).toMatchObject({ coverage: 'commander-visible', outcome: 'submitted' });
  });

  it('routes correct OpenCode and Codex addresses to P2 and P4 in the mixed four-panel layout', async () => {
    const f = fixture();
    f.emit(0, { targetAgent: 'opencode', targetPanel: 1, content: 'hello P2' });
    f.emit(2, { targetAgent: 'codex', targetPanel: 3, content: 'hello P4' });
    await vi.runAllTimersAsync();
    expect(f.input(1)).toContain('hello P2');
    expect(f.input(1)).not.toContain('hello P4');
    expect(f.input(3)).toContain('hello P4');
    expect(f.input(3)).not.toContain('hello P2');
    expect(f.orchestrator.getRecentActivity().map(record => record.status)).toEqual(['delivered', 'delivered']);
    expect(f.manager.launchAgent).not.toHaveBeenCalled();
    expect(f.manager.killAgent).not.toHaveBeenCalled();
  });

  it.each(['agents', 'panels'])('delivers every exact stable address in a narrow Claude QUERY %s response', async query => {
    const f = fixture();
    f.emit(2, { type: 'query', targetAgent: 'generic', targetPanel: -1, content: query });
    await vi.runAllTimersAsync();
    for (const address of ['opencode:1', 'opencode:2', 'claude:3', 'codex:4']) {
      expect(f.input(2)).toContain(`SEND address ${address}`);
    }
    expect(f.input(2)).not.toContain('SEND address codex:2');
    const feedback = f.events.find(event => event.type === 'controller.feedback')!;
    expect(feedback.content).toContain('\n');
    expect(feedback.content).toContain('codex:4');
    expect(feedback.coverage).toBe('commander-visible');
    expect(f.events.some(event => event.type === 'input.unknown')).toBe(false);
  });

  it('preserves long UTF-8 feedback using bounded chunks and one paste submission', async () => {
    const f = fixture();
    const message = `[Commander] Full information:\n${'🙂 current roster detail '.repeat(200)}END_OF_FEEDBACK`;
    f.internals.sendInfoToPanel(2, message);
    await vi.runAllTimersAsync();
    expect(f.input(2)).toBe(`\x1b[200~${message}\x1b[201~\r`);
    expect(f.panels[2].sendInput.mock.calls.every(([text]) => Buffer.byteLength(text, 'utf8') <= 1024)).toBe(true);
    expect(f.events.find(event => event.type === 'controller.feedback')).toMatchObject({ content: message, coverage: 'commander-visible' });
  });

  it('does not submit long feedback into a replacement Claude session', async () => {
    const f = fixture();
    f.internals.sendInfoToPanel(2, `[Commander] ${'long feedback '.repeat(200)}`);
    f.panels[2].sessionId = 'replacement-session';
    await vi.runAllTimersAsync();
    expect(f.input(2)).not.toContain('\r');
    expect(f.events.some(event => event.type === 'controller.feedback' && event.outcome === 'submitted')).toBe(false);
    expect(f.events.find(event => event.type === 'input.unknown')).toMatchObject({ reason: 'partial_controller_feedback' });
  });

  it('marks incomplete feedback after a thrown mid-paste write without reporting successful submission', async () => {
    const f = fixture();
    f.panels[2].sendInput.mockImplementationOnce(() => true).mockImplementationOnce(() => {
      throw new Error('synthetic PTY write failure');
    });
    f.internals.sendInfoToPanel(2, `[Commander] ${'long feedback '.repeat(200)}`);
    await vi.runAllTimersAsync();
    expect(f.events.some(event => event.type === 'controller.feedback' && event.outcome === 'submitted')).toBe(false);
    expect(f.events.find(event => event.type === 'input.unknown')).toMatchObject({ reason: 'partial_controller_feedback' });
    expect(f.events.find(event => event.type === 'controller.feedback')).toMatchObject({ outcome: 'failed', reason: 'feedback_delivery_failed' });
    expect(f.input(2)).not.toContain('\r');
  });

  it('reads the template roster after waiting for the input lane, without rewriting explicit custom targets', async () => {
    const f = fixture();
    let release!: () => void;
    const heldLane = new Promise<void>(resolve => { release = resolve; });
    f.internals.inputLaneTails.set(f.panels[2].sessionId, heldLane);
    const template = 'Ask <codex-panel> for help. Explicit custom address codex:4 remains data.\n===COMMANDER:QUERY===\nagents\n===COMMANDER:END===';
    const prepared = f.orchestrator.prepareTemplateTask(2, template, true);
    expect(prepared.success).toBe(true);
    if (!prepared.success) throw new Error(prepared.error);
    const delivery = f.orchestrator.sendTemplateTask('claude', 2, prepared);
    expect(f.input(2)).toBe('');
    f.panels[3].type = 'gemini';
    f.panels[3].name = 'Gemini CLI';
    release();
    await vi.runAllTimersAsync();
    expect(await delivery).toEqual({ success: true });
    expect(f.input(2)).toContain('P4: adapter=gemini');
    expect(f.input(2)).toContain('<codex-panel>: no other running codex agent');
    expect(f.input(2)).toContain('Explicit custom address codex:4 remains data.');
    expect(f.input(2)).not.toContain('P4: adapter=codex');
  });
});
