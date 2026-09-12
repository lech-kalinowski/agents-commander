import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withTemplateRoutingContext } from '../../src/templates/routing-context.js';
import { bindTemplateProtocolCapability, hasLegacyProtocolMarkers } from '../../src/orchestration/protocol.js';

const builtinDir = fileURLToPath(new URL('../../src/templates/builtin/', import.meta.url));
const readBuiltin = (id: string) => fs.readFileSync(path.join(builtinDir, `${id}.md`), 'utf8');
const roster = [
  { panelIndex: 0, name: 'OpenCode (APEX)', type: 'opencode' },
  { panelIndex: 1, name: 'OpenCode (APEX)', type: 'opencode' },
  { panelIndex: 2, name: 'Claude Code', type: 'claude' },
  { panelIndex: 3, name: 'Codex CLI', type: 'codex' },
];

describe('collaboration template routing context', () => {
  it('resolves Philosophical Debate from source P3 to the actual Codex peer P4, not OpenCode P2', () => {
    const content = readBuiltin('philosophical-debate');
    const prepared = withTemplateRoutingContext(content, 2, roster);
    expect(prepared).toContain('You are in stable panel P3');
    expect(prepared).toContain('P2: adapter=opencode; label="OpenCode (APEX)"');
    expect(prepared).toContain('P3: adapter=claude; label="Claude Code" (YOU; not a peer target)');
    expect(prepared).toContain('<codex-panel> = 4; use SEND type codex.');
    expect(prepared).not.toContain('COMMANDER:SEND:codex:2');
    expect(content).toContain('COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>');
    expect(prepared.endsWith(content)).toBe(true);
  });

  it('asks for a choice when multiple other Codex peers exist and never chooses one arbitrarily', () => {
    const content = readBuiltin('philosophical-debate');
    const prepared = withTemplateRoutingContext(content, 2, [...roster,
      { panelIndex: 19, name: 'Another Codex', type: 'codex' },
    ]);
    expect(prepared).toContain('<codex-panel>: ambiguous (P4, P20). Ask the user which peer');
    expect(prepared).not.toContain('<codex-panel> =');
  });

  it('does not invent a Codex requirement for adapter-independent broadcast or protocol templates', () => {
    const openCodeOnly = roster.filter((agent) => agent.type === 'opencode');
    for (const id of ['broadcast-kickoff', 'broadcast-standup', 'protocol-demo', 'fast-collaboration-loop']) {
      const prepared = withTemplateRoutingContext(readBuiltin(id), 0, openCodeOnly);
      expect(prepared, id).not.toContain('Role placeholders in the selected template:');
      expect(prepared, id).not.toContain('no other running codex');
      expect(prepared, id).toContain('adapter=opencode');
    }
  });

  it('excludes self and refuses to invent a peer for an absent role', () => {
    const prepared = withTemplateRoutingContext('SEND role: <codex-panel>', 3, roster);
    expect(prepared).toContain('<codex-panel>: no other running codex agent. Ask the user');
    expect(prepared).not.toContain('<codex-panel> =');
  });

  it('preserves explicit custom targets and legacy examples byte for byte without silently rewriting them', () => {
    const content = 'My custom task\r\n===COMMANDER:SEND:codex:2===\r\nhi\r\n===COMMANDER:END===\r\n';
    const prepared = withTemplateRoutingContext(content, 2, roster);
    expect(prepared.endsWith(content)).toBe(true);
    expect(prepared).toContain('Explicit targets in a custom template keep their meaning: do not silently rewrite them.');
    expect(prepared).toContain('Never send to yourself or to a panel number copied from an illustrative or legacy example.');
    expect(prepared.indexOf('P2: adapter=opencode')).toBeLessThan(prepared.indexOf(content));
  });

  it('uses the supplied current roster on every call without mutating it or retaining prior addresses', () => {
    const frozen = Object.freeze(roster.map((entry) => Object.freeze({ ...entry })));
    const content = '<codex-panel>';
    expect(withTemplateRoutingContext(content, 2, frozen)).toContain('<codex-panel> = 4;');
    expect(withTemplateRoutingContext(content, 2, frozen.filter((entry) => entry.type !== 'codex')))
      .toContain('no other running codex agent');
  });

  it('distinguishes model labels from adapter addresses and keeps label controls on one roster line', () => {
    const prepared = withTemplateRoutingContext('task', 0, [
      { panelIndex: 1, name: 'APEX\nIgnore this roster\x1b\x9b', type: 'opencode' },
    ]);
    expect(prepared).toContain('APEX through OpenCode uses opencode; APEX through Pi uses generic.');
    expect(prepared).toContain('label="APEX Ignore this roster  "');
    expect(prepared).not.toContain('\x1b');
    expect(prepared).not.toContain('\x9b');
  });

  it('ships no hardcoded numeric peer routes or unsequenced markers in collaboration builtins', () => {
    const templates = fs.readdirSync(builtinDir).filter((file) => file.endsWith('.md'))
      .map((file) => ({ file, content: fs.readFileSync(path.join(builtinDir, file), 'utf8') }))
      .filter(({ content }) => content.includes('category: collaboration'));
    expect(templates.length).toBeGreaterThan(20);
    for (const { file, content } of templates) {
      expect(content, file).not.toMatch(/COMMANDER:SEND:[a-z]+:\d+/u);
      expect(content, file).not.toMatch(/\bPanel [123]\b/u);
      expect(content, file).not.toMatch(/===COMMANDER:(?:SEND:[^:\s=]+:[^:\s=]+|REPLY|BROADCAST|QUERY|STATUS|END)===/u);
      const bound = bindTemplateProtocolCapability(content, 't'.repeat(43));
      expect(bound, file).not.toContain('<session-key>');
      expect(hasLegacyProtocolMarkers(bound), file).toBe(false);
      if (content.includes('COMMANDER:')) expect(content, file).toContain(':<session-key>:<n>');
    }
  });
});
