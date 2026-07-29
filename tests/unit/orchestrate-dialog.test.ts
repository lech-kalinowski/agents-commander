import { describe, expect, it } from 'vitest';
import { discoverAgents } from '../../src/agents/agent-registry.js';
import { getAvailableOrchestrationAgents } from '../../src/screen/dialog/orchestrate-dialog.js';

describe('orchestration agent discovery', () => {
  it('uses the same configured command and arguments as the launch dialog', () => {
    const overrides = {
      generic: {
        command: process.execPath,
        args: ['--version'],
        env: { AGENTS_COMMANDER_TEST: '1' },
      },
    };

    const launchAgent = discoverAgents(overrides).find((agent) => agent.type === 'generic');
    const orchestrationAgent = getAvailableOrchestrationAgents(overrides)
      .find((agent) => agent.type === 'generic');

    expect(orchestrationAgent).toEqual(launchAgent);
    expect(orchestrationAgent).toMatchObject({
      command: process.execPath,
      args: ['--version'],
      env: { AGENTS_COMMANDER_TEST: '1' },
      installed: true,
      supported: true,
    });
  });
});
