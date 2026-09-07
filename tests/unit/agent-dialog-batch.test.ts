import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showAgentDialog } from '../../src/screen/dialog/agent-dialog.js';
import { closeDialogsForScreen, isDialogActive } from '../../src/utils/dialog-state.js';

vi.mock('../../src/agents/agent-registry.js', () => ({
  discoverAgents: () => Array.from({ length: 21 }, (_, index) => ({
    type: 'generic',
    profileId: `profile-${index + 1}`,
    profileLabel: `Profile ${index + 1}`,
    description: 'Synthetic batch picker profile',
    installCommand: 'synthetic-install',
    installed: index !== 2,
    supported: true,
    ...(index === 3 ? { configurationError: 'Synthetic invalid profile' } : {}),
  })),
}));

function createFixture() {
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
    open(maxNewPanels?: number, panelIds = [0, 5]) {
      return showAgentDialog(screen, getTheme('midnight'), panelIds, 0,
        undefined, undefined, maxNewPanels === undefined ? {} : { maxNewPanels });
    },
    content() {
      const parent = screen.focused.parent as blessed.Widgets.BoxElement;
      return parent.children.map((child) => (child as blessed.Widgets.BoxElement).getContent()).join('\n');
    },
    dispose() {
      closeDialogsForScreen(screen);
      screen.destroy();
      input.destroy();
      output.destroy();
    },
  };
}

describe('F2 new-terminal batch picker', () => {
  it.each([10, 16, 20])('selects %i NEW terminals with the same profile and source directory', async (count) => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(40);
      fixture.input.write(`N${count}\u001b[B\u001b[C`);
      expect(fixture.content()).toContain(`NEW terminals: [${count}]`);
      expect(fixture.content()).toContain('Capacity: 40');
      expect(fixture.content()).toContain('Existing panels unchanged');
      expect(fixture.content()).toContain('Directory from P6');
      fixture.input.write('\r');
      await expect(decision).resolves.toEqual({
        agentType: 'generic', profileId: 'profile-2', panelIndex: 5, newPanelCount: count,
      });
    } finally {
      fixture.dispose();
    }
  });

  it.each([7, 16, 40])('defaults to the smaller of 16 and capacity %i', async (capacity) => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(capacity);
      fixture.input.write('n\r');
      await expect(decision).resolves.toMatchObject({ newPanelCount: Math.min(16, capacity) });
    } finally {
      fixture.dispose();
    }
  });

  it('keeps the default launch result unchanged when batch is available but not selected', async () => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(40);
      fixture.input.write('\u001b[C\r');
      await expect(decision).resolves.toEqual({
        agentType: 'generic', profileId: 'profile-1', panelIndex: 5,
      });
    } finally {
      fixture.dispose();
    }
  });

  it('does not enable batch controls for single-target callers', async () => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(undefined, [0, 15, 19]);
      expect(fixture.content()).not.toContain('N=New panels');
      fixture.input.write('N16\r');
      await expect(decision).resolves.toEqual({
        agentType: 'generic', profileId: 'profile-1', panelIndex: 15,
      });
    } finally {
      fixture.dispose();
    }
  });

  it.each(['0', '21', '200', '01', '1.5', '-1', '1e1', '\u007f\u007f'])(
    'rejects invalid count %j without clamping or closing', async (keys) => {
      const fixture = createFixture();
      try {
        const decision = fixture.open(20);
        let settled = false;
        void decision.then(() => { settled = true; });
        fixture.input.write(`n${keys}\r`);
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(isDialogActive()).toBe(true);
        expect(fixture.screen.focused.type).toBe('list');
        expect(fixture.content()).toContain('Invalid: enter a whole count from 1 to 20.');
        fixture.input.write('\u001b');
        await expect(decision).resolves.toBeNull();
      } finally {
        fixture.dispose();
      }
    },
  );

  it('edits counts with Backspace and keeps count input separate from source navigation', async () => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(40);
      fixture.input.write('n200\u007f\u001b[C\r');
      await expect(decision).resolves.toEqual({
        agentType: 'generic', profileId: 'profile-1', panelIndex: 5, newPanelCount: 20,
      });
    } finally {
      fixture.dispose();
    }
  });

  it.each([0, -1, 1.5, Number.NaN])('keeps single launch available with unusable capacity %s', async (capacity) => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(capacity);
      fixture.input.write('n16\r');
      await Promise.resolve();
      expect(fixture.content()).toContain('No capacity. N returns to single-panel launch.');
      expect(isDialogActive()).toBe(true);
      fixture.input.write('n\r');
      await expect(decision).resolves.toEqual({
        agentType: 'generic', profileId: 'profile-1', panelIndex: 0,
      });
    } finally {
      fixture.dispose();
    }
  });

  it('does not exceed the 100-panel bound even if a caller overstates capacity', async () => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(100);
      fixture.input.write('n99\r');
      await Promise.resolve();
      expect(fixture.content()).toContain('Capacity: 98');
      expect(isDialogActive()).toBe(true);
      fixture.input.write('\u007f8\r');
      await expect(decision).resolves.toMatchObject({ newPanelCount: 98 });
    } finally {
      fixture.dispose();
    }
  });

  it('freezes the queued batch choice and contains Blessed Enter/Return', async () => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(40);
      fixture.input.write('n16');
      fixture.programKeys.length = 0;
      fixture.input.write('\rN20\u001b[B\u001b[C\r');
      expect(isDialogActive()).toBe(true);
      await expect(decision).resolves.toEqual({
        agentType: 'generic', profileId: 'profile-1', panelIndex: 0, newPanelCount: 16,
      });
      expect(fixture.programKeys.slice(0, 2)).toEqual(['enter', 'return']);
      expect(fixture.leakedKeys).toEqual([]);
      expect(fixture.screen.focused).toBe(fixture.terminal);
      expect(fixture.screen.grabKeys).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it('lets screen cancellation override a queued batch and reopen normally', async () => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(40);
      fixture.input.write('n20\r');
      closeDialogsForScreen(fixture.screen);
      await expect(decision).resolves.toBeNull();
      const nextDecision = fixture.open(40);
      expect(fixture.content()).toContain('Target panel:');
      fixture.input.write('\u001b');
      await expect(nextDecision).resolves.toBeNull();
      expect(fixture.leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  it.each([2, 3])('preserves unavailable/invalid profile validation for row %i', async (index) => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(40);
      fixture.input.write(`n16${'\u001b[B'.repeat(index)}\r`);
      expect(fixture.screen.focused.type).toBe('box');
      expect(fixture.screen.focused.getContent()).toContain(index === 2 ? 'Not installed' : 'Invalid profile');
      fixture.input.write('\r');
      await expect(decision).resolves.toBeNull();
    } finally {
      fixture.dispose();
    }
  });

  it('keeps profile selection and batch content bounded across resize', async () => {
    const fixture = createFixture();
    try {
      const decision = fixture.open(40);
      const list = fixture.screen.focused as blessed.Widgets.ListElement & {
        selected: number; childBase: number;
      };
      const dialog = list.parent as blessed.Widgets.BoxElement;
      fixture.input.write(`n20${'\u001b[B'.repeat(20)}`);
      for (const [columns, rows] of [[60, 18], [40, 14], [100, 30]]) {
        Object.assign(fixture.output, { columns, rows });
        Object.assign(fixture.screen.program, { cols: columns, rows });
        fixture.screen.program.emit('resize');
        fixture.screen.render();
        expect(Number(dialog.width)).toBeLessThanOrEqual(columns - 2);
        expect(Number(dialog.height)).toBeLessThanOrEqual(rows - 2);
        expect(Number(list.top) + Number(list.height)).toBeLessThan(Number(dialog.height) - 2);
        const panelLabel = dialog.children.find((child) => (
          (child as blessed.Widgets.BoxElement).getContent().includes('NEW terminals:')
        )) as blessed.Widgets.BoxElement;
        expect(Number(panelLabel.top) + Number(panelLabel.height)).toBeLessThanOrEqual(Number(dialog.height) - 2);
        expect(list.selected).toBe(20);
        expect(list.selected).toBeGreaterThanOrEqual(list.childBase);
        expect(list.selected).toBeLessThan(list.childBase + Number(list.height));
        expect(fixture.content()).toContain('NEW terminals: [20]');
      }
      fixture.input.write('\r');
      await expect(decision).resolves.toMatchObject({ profileId: 'profile-21', newPanelCount: 20 });
    } finally {
      fixture.dispose();
    }
  });
});
