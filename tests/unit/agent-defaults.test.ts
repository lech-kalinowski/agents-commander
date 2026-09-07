import { describe, expect, it } from 'vitest';
import { KNOWN_AGENTS } from '../../src/agents/types.js';
import { defaultConfig } from '../../src/config/defaults.js';

describe('agent defaults', () => {
  it('derives configuration defaults from the canonical agent catalog', () => {
    for (const agent of KNOWN_AGENTS) {
      expect(defaultConfig.agents[agent.type]).toEqual({
        command: agent.command,
        args: agent.args,
        env: agent.env,
      });
    }
  });

  it('uses safe interactive defaults for supported AI agents', () => {
    expect(defaultConfig.agents.claude.args).toEqual([]);
    expect(defaultConfig.agents.codex.args).toEqual(['--no-alt-screen']);
    expect(defaultConfig.agents.gemini.args).toEqual([]);
  });
});
