import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showAgentDialog } from '../../src/screen/dialog/agent-dialog.js';
import { showOrchestrateDialog } from '../../src/screen/dialog/orchestrate-dialog.js';
import { closeDialogsForScreen, isDialogActive } from '../../src/utils/dialog-state.js';

vi.mock('../../src/agents/agent-registry.js', () => ({
  discoverAgents: () => [1, 2].map((number) => ({
    type: 'generic',
    profileId: `apex-pi-${number}`,
    profileLabel: `APEX Pi ${number}`,
    description: 'Synthetic profile for modal input tests',
    installed: true,
    supported: true,
  })),
}));

function createTerminalScreen() {
  const input = new PassThrough();
  const output = new PassThrough();
  for (const stream of [input, output]) {
    Object.assign(stream, { isTTY: true, columns: 100, rows: 30, setRawMode: vi.fn() });
  }
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const terminal = blessed.box({ parent: screen, keys: true, input: true });
  const leakedKeys: string[] = [];
  const programKeys: string[] = [];
  terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
  screen.program.on('keypress', (_character, key) => programKeys.push(key.name));
  terminal.focus();
  return {
    input, output, screen, terminal, leakedKeys, programKeys,
    dispose() {
      closeDialogsForScreen(screen);
      screen.destroy();
      input.destroy();
      output.destroy();
    },
  };
}

type Fixture = ReturnType<typeof createTerminalScreen>;
type Picker = 'launch' | 'orchestrate';

async function prepareChoice(fixture: Fixture, picker: Picker) {
  const { input, screen } = fixture;
  const decision = picker === 'launch'
    ? showAgentDialog(screen, getTheme('midnight'), [0, 2], 0)
    : showOrchestrateDialog(screen, getTheme('midnight'), [0, 2], 0);
  if (picker === 'orchestrate') input.write('\r');
  input.write('\u001b[C');
  if (picker === 'orchestrate') {
    input.write('\r');
    // Blessed begins textbox input on the next tick, excluding the opening Enter.
    await new Promise<void>((resolve) => setImmediate(resolve));
    input.write('  Coordinate the synthetic agents  ');
  }
  fixture.programKeys.length = 0;
  return { decision };
}

function expectedChoice(picker: Picker) {
  return {
    agentType: 'generic',
    profileId: 'apex-pi-1',
    panelIndex: 2,
    ...(picker === 'orchestrate' ? { task: 'Coordinate the synthetic agents' } : {}),
  };
}

describe('agent picker terminal input shield', () => {
  it.each<Picker>(['launch', 'orchestrate'])(
    'contains the %s picker Enter and Return before restoring terminal focus',
    async (picker) => {
      const fixture = createTerminalScreen();
      try {
        const { decision } = await prepareChoice(fixture, picker);
        fixture.input.write('\r');
        expect(isDialogActive()).toBe(true);
        await expect(decision).resolves.toEqual(expectedChoice(picker));
        expect(fixture.programKeys).toEqual(['enter', 'return']);
        expect(fixture.leakedKeys).toEqual([]);
        expect(fixture.screen.focused).toBe(fixture.terminal);
        expect(fixture.screen.grabKeys).toBe(false);
        expect(isDialogActive()).toBe(false);
      } finally {
        fixture.dispose();
      }
    },
  );

  it.each<Picker>(['launch', 'orchestrate'])(
    'freezes a queued %s choice against later keys in the same input chunk',
    async (picker) => {
      const fixture = createTerminalScreen();
      try {
        const { decision } = await prepareChoice(fixture, picker);
        const list = picker === 'launch'
          ? fixture.screen.focused as blessed.Widgets.ListElement & { selected: number }
          : null;
        fixture.input.write('\r\u001b[B\u001b[C1\r');
        if (list) expect(list.selected).toBe(0);
        await expect(decision).resolves.toEqual(expectedChoice(picker));
        expect(fixture.leakedKeys).toEqual([]);
        expect(fixture.screen.focused).toBe(fixture.terminal);
        expect(fixture.screen.grabKeys).toBe(false);
        expect(isDialogActive()).toBe(false);
      } finally {
        fixture.dispose();
      }
    },
  );

  it.each<Picker>(['launch', 'orchestrate'])(
    'lets screen cancellation override a queued %s success',
    async (picker) => {
      const fixture = createTerminalScreen();
      try {
        const { decision } = await prepareChoice(fixture, picker);
        fixture.input.write('\r');
        closeDialogsForScreen(fixture.screen);
        await expect(decision).resolves.toBeNull();
        expect(fixture.leakedKeys).toEqual([]);
        expect(fixture.screen.focused).toBe(fixture.terminal);
        expect(fixture.screen.grabKeys).toBe(false);
        expect(isDialogActive()).toBe(false);
      } finally {
        fixture.dispose();
      }
    },
  );

  it.each(['cancel', 'destroy'] as const)(
    'can %s while orchestration textbox input is active without reopening the picker',
    async (action) => {
      const fixture = createTerminalScreen();
      try {
        const { decision } = await prepareChoice(fixture, 'orchestrate');
        const textbox = fixture.screen.focused as blessed.Widgets.TextboxElement;
        const dialog = textbox.parent;
        expect(textbox.type).toBe('textbox');
        expect(fixture.screen.grabKeys).toBe(true);
        if (action === 'destroy') fixture.screen.destroy();
        else closeDialogsForScreen(fixture.screen);
        await expect(decision).resolves.toBeNull();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(isDialogActive()).toBe(false);
        expect(fixture.screen.grabKeys).toBe(false);
        expect(dialog.detached).toBe(true);
        expect(fixture.leakedKeys).toEqual([]);

        // A stale module-level open flag must not prevent a subsequent dialog.
        const nextFixture = createTerminalScreen();
        try {
          const nextDecision = showOrchestrateDialog(
            nextFixture.screen, getTheme('midnight'), [0, 2], 0,
          );
          expect(nextFixture.screen.focused.type).toBe('list');
          expect(isDialogActive()).toBe(true);
          closeDialogsForScreen(nextFixture.screen);
          await expect(nextDecision).resolves.toBeNull();
          expect(isDialogActive()).toBe(false);
        } finally {
          nextFixture.dispose();
        }
      } finally {
        fixture.dispose();
      }
    },
  );
});
