import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_PROFILES } from '../../src/agents/types.js';
import { discoverAgentsWithResolver } from '../../src/agents/agent-registry.js';
import { buildProtocolInstructions, isAgentType, ProtocolScanner, type CommanderMessage } from '../../src/orchestration/protocol.js';
import { validateInput } from '../../src/capture/schema.js';
import { wireFrame } from '../../src/dataset/normalize.js';
import { withTemplateRoutingContext } from '../../src/templates/routing-context.js';

describe('Antigravity adapter', () => {
  it('discovers agy independently of Gemini and retains configured Gemini commands', () => {
    const agents = discoverAgentsWithResolver({
      gemini: { command: '/custom/gemini', args: ['--custom'], env: {} },
    }, DEFAULT_AGENT_PROFILES, command => command === 'agy' ? '/home/test/.local/bin/agy' : null);
    expect(agents.find(agent => agent.type === 'antigravity')).toMatchObject({
      profileId: 'antigravity', command: '/home/test/.local/bin/agy', args: [], installed: true, supported: true,
    });
    expect(agents.find(agent => agent.type === 'gemini')).toMatchObject({
      command: '/custom/gemini', args: ['--custom'], installed: false, deprecated: true,
    });
    expect(agents.at(-1)?.type).toBe('gemini');
    expect(isAgentType('antigravity')).toBe(true);
    expect(isAgentType('agy')).toBe(false);
  });

  it('honors explicit named Antigravity profiles without changing their options', () => {
    const profiles = discoverAgentsWithResolver({}, [{
      id: 'agy-plan', label: 'Antigravity Plan', adapter: 'antigravity',
      command: '/opt/agy', args: ['--mode', 'plan'], env: { TEST_ONLY: '1' },
    }], command => command);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ type: 'antigravity', args: ['--mode', 'plan'], env: { TEST_ONLY: '1' } });
  });

  it('retains installed legacy profiles and marks custom labels as deprecated', () => {
    const profiles = discoverAgentsWithResolver({}, [
      { id: 'company-google', label: 'Company Google', adapter: 'gemini', command: '/opt/gemini', args: ['--custom'] },
      { id: 'google', label: 'Google', adapter: 'antigravity' },
    ], command => command);
    expect(profiles.map(profile => profile.profileId)).toEqual(['google', 'company-google']);
    expect(profiles[1]).toMatchObject({ supported: true, installed: true, deprecated: true,
      command: '/opt/gemini', args: ['--custom'], profileLabel: 'Company Google' });
  });

  it('parses sequenced SEND and REPLY frames with exact Antigravity addresses', () => {
    const key = 'a'.repeat(43);
    const messages: CommanderMessage[] = [];
    const scanner = new ProtocolScanner(0, 'Antigravity CLI', message => messages.push(message));
    scanner.feed(`===COMMANDER:SEND:antigravity:2:${key}:1===\nHello\n===COMMANDER:END:${key}:1===\n`);
    scanner.feed(`===COMMANDER:REPLY:${key}:2===\nReply\n===COMMANDER:END:${key}:2===\n`);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: 'send', targetAgent: 'antigravity', targetPanel: 1, sequence: 1 });
    expect(messages[1]).toMatchObject({ type: 'reply', sequence: 2 });
    expect(buildProtocolInstructions(0, 'Antigravity CLI', [], key)).toContain('antigravity');
  });

  it('supports consented capture/export without leaking a live capability', () => {
    expect(validateInput({ type: 'session.start', actor: { sessionId: 'agy_session', panel: 1, agentType: 'antigravity' } })).toBe(true);
    const result = wireFrame({ verb: 'send', targetAgent: 'antigravity', targetPanel: 2,
      content: 'Synthetic test', capabilityRef: 'cap_1', protocolSequence: 1 });
    expect(result).toContain('SEND:antigravity:2:<cap:cap_1>:1');
  });

  it('resolves Antigravity template roles without silently migrating Gemini targets', () => {
    const context = withTemplateRoutingContext('Send to <antigravity-panel>; legacy <gemini-panel>.', 0, [
      { panelIndex: 0, name: 'Codex CLI', type: 'codex' },
      { panelIndex: 5, name: 'Antigravity CLI', type: 'antigravity' },
    ]);
    expect(context).toContain('<antigravity-panel> = 6; use SEND type antigravity.');
    expect(context).toContain('<gemini-panel>: no other running gemini agent.');
  });
});
