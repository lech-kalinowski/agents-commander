import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { discoverAgents } from '../../src/agents/agent-registry.js';
import { getTheme } from '../../src/config/themes.js';
import {
  getAvailableOrchestrationAgents,
  showOrchestrateDialog,
} from '../../src/screen/dialog/orchestrate-dialog.js';

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

describe('orchestration profile picker', () => {
  it('keeps a large profile list scrollable and its selected row visible across resize', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    for (const stream of [input, output]) {
      Object.assign(stream, { isTTY: true, columns: 100, rows: 30, setRawMode: vi.fn() });
    }
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const profiles = Array.from({ length: 21 }, (_, index) => ({
      id: `profile-${index + 1}`,
      label: `Profile ${index + 1}`,
      adapter: 'generic' as const,
      command: process.execPath,
      args: [],
    }));

    try {
      const decision = showOrchestrateDialog(screen, getTheme('midnight'), 16, 0, undefined, profiles);
      const list = screen.focused as blessed.Widgets.ListElement & {
        selected: number;
        childBase: number;
      };
      const dialog = list.parent as blessed.Widgets.BoxElement;
      expect(list.type).toBe('list');
      expect(list.height).toBe(16);

      for (let index = 1; index < profiles.length; index++) input.write('\u001b[B');
      expect(list.selected).toBe(20);
      expect(list.childBase).toBeGreaterThan(0);

      for (const rows of [18, 30]) {
        Object.assign(output, { rows });
        Object.assign(screen.program, { rows });
        screen.program.emit('resize');
        screen.render();
        expect(list.height).toBe(Math.min(profiles.length, Number(dialog.height) - 6));
        expect(Number(list.top) + Number(list.height)).toBeLessThanOrEqual(Number(dialog.height) - 2);
        expect(list.selected).toBe(20);
        expect(list.selected).toBeGreaterThanOrEqual(list.childBase);
        expect(list.selected).toBeLessThan(list.childBase + Number(list.height));
      }

      // The off-screen profile remains reachable through the normal three-step dialog.
      input.write('\r');
      input.write('\r');
      // Blessed registers textbox input on the next tick to exclude its activating Enter.
      await new Promise<void>((resolve) => setImmediate(resolve));
      input.write('START APEX SHOWCASE');
      input.write('\r');
      await expect(decision).resolves.toEqual({
        agentType: 'generic', profileId: 'profile-21', panelIndex: 0, task: 'START APEX SHOWCASE',
      });
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });
});
