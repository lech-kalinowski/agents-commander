import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import {
  showProtocolBatchDialog, type ProtocolBatchPanel,
} from '../../src/screen/dialog/protocol-batch-dialog.js';
import { closeDialogsForScreen, isDialogActive } from '../../src/utils/dialog-state.js';

type TestList = blessed.Widgets.ListElement & {
  selected: number; childBase: number; items: blessed.Widgets.BoxElement[];
};

function panel(panelIndex: number, armed = false): ProtocolBatchPanel {
  return { panelIndex, name: `Agent ${panelIndex + 1}`, profileId: `profile-${panelIndex}`, armed };
}

function fixture() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const terminal = blessed.box({ parent: screen, keys: true, input: true, mouse: true });
  const leaked: string[] = [];
  const shortcuts: string[] = [];
  const programKeys: string[] = [];
  terminal.on('keypress', (_ch, key) => leaked.push(key.name));
  screen.on('keypress', (_ch, key) => shortcuts.push(key.name));
  screen.program.on('keypress', (_ch, key) => programKeys.push(key.name));
  terminal.focus();
  return {
    input, output, screen, terminal, leaked, shortcuts, programKeys,
    open(panels: ProtocolBatchPanel[] = [panel(5), panel(0), panel(9, true)]) {
      return showProtocolBatchDialog(screen, getTheme('midnight'), panels);
    },
    dialog() { return screen.focused as blessed.Widgets.BoxElement; },
    list() { return screen.focused.children.find((child) => child.type === 'list') as TestList; },
    click(element: blessed.Widgets.BoxElement, button = 0) {
      const x = Number(element.aleft) + 2;
      const y = Number(element.atop) + 1;
      input.write(`\u001b[<${button};${x};${y}M`);
      input.write(`\u001b[<${button};${x};${y}m`);
    },
    dispose() {
      closeDialogsForScreen(screen); screen.destroy(); input.destroy(); output.destroy();
    },
  };
}

describe('explicit protocol batch selection', () => {
  it('shows stable P-number order and no implicit consent', async () => {
    const f = fixture();
    try {
      const source = [panel(99), panel(5), panel(0), panel(9, true)];
      const decision = f.open(source);
      expect(f.list().items.map((item) => item.getText())).toEqual([
        '[ ] P1 Agent 1 (profile-0)', '[ ] P6 Agent 6 (profile-5)',
        '[-] P10 ALREADY ENABLED Agent 10 (profile-9)', '[ ] P100 Agent 100 (profile-99)',
      ]);
      expect(source.map((item) => item.panelIndex)).toEqual([99, 5, 0, 9]);
      f.input.write('\r');
      await expect(decision).resolves.toEqual([]);
      expect(f.leaked).toEqual([]);
      expect(f.shortcuts).toEqual([]);
      expect(f.programKeys).toEqual(['enter', 'return']);
      expect(f.screen.focused).toBe(f.terminal);
      expect(f.screen.grabKeys).toBe(false);
    } finally { f.dispose(); }
  });

  it('selects a subset with navigation and Space but never toggles armed rows', async () => {
    const f = fixture();
    try {
      const decision = f.open([panel(20), panel(2, true), panel(0), panel(7)]);
      f.input.write(' \u001b[B \u001b[B \u001b[B \u001b[A ');
      expect(f.list().selected).toBe(2);
      f.input.write('\r');
      await expect(decision).resolves.toEqual([0, 20]);
      expect(f.leaked).toEqual([]);
    } finally { f.dispose(); }
  });

  it.each(['a', 'A', 'aNA'])('selects all unarmed sessions with %j', async (keys) => {
    const f = fixture();
    try {
      const decision = f.open();
      f.input.write(`${keys}\r`);
      await expect(decision).resolves.toEqual([0, 5]);
    } finally { f.dispose(); }
  });

  it.each(['an', 'AN'])('clears all selections with %j', async (keys) => {
    const f = fixture();
    try {
      const decision = f.open();
      f.input.write(`${keys}\r`);
      await expect(decision).resolves.toEqual([]);
    } finally { f.dispose(); }
  });

  it('navigates a complete page and Home/End without selecting implicitly', async () => {
    const f = fixture();
    try {
      const decision = f.open(Array.from({ length: 100 }, (_, index) => panel(index)));
      const page = Number(f.list().height) - 1;
      f.input.write('\u001b[6~');
      expect(f.list().selected).toBe(page);
      f.input.write(' \u001b[5~');
      expect(f.list().selected).toBe(0);
      f.input.write('\u001b[F');
      expect(f.list().selected).toBe(99);
      f.input.write(' \u001b[H');
      expect(f.list().selected).toBe(0);
      f.input.write('\r');
      await expect(decision).resolves.toEqual([page, 99]);
    } finally { f.dispose(); }
  });

  it('freezes selected rows during the queued Enter/Return handoff', async () => {
    const f = fixture();
    try {
      const decision = f.open();
      f.input.write(' \rA\u001b[B \r');
      expect(isDialogActive()).toBe(true);
      await expect(decision).resolves.toEqual([0]);
      expect(f.leaked).toEqual([]);
      expect(f.shortcuts).toEqual([]);
    } finally { f.dispose(); }
  });

  it('makes each mouse row click toggle only, with armed rows and right-click disabled', async () => {
    const f = fixture();
    try {
      const leakedClick = vi.fn();
      f.terminal.on('click', leakedClick);
      const decision = f.open();
      const rows = f.list().items;
      f.click(rows[1]);
      expect(rows[1].getText()).toMatch(/^\[x\] P6/u);
      f.click(rows[0]);
      f.click(rows[0]);
      expect(rows[0].getText()).toMatch(/^\[ \] P1/u);
      f.click(rows[2]);
      f.click(rows[0], 2);
      expect(isDialogActive()).toBe(true);
      expect(f.screen.focused.type).toBe('box');
      const button = f.dialog().children.find((child) => (
        (child as blessed.Widgets.BoxElement).getText() === '[Continue]'
      )) as blessed.Widgets.BoxElement;
      f.click(button, 2);
      expect(isDialogActive()).toBe(true);
      f.click(button);
      await expect(decision).resolves.toEqual([5]);
      expect(leakedClick).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });

  it.each(['escape', 'mouse'])('cancels through %s without returning selections', async (method) => {
    const f = fixture();
    try {
      const decision = f.open();
      f.input.write('a');
      if (method === 'escape') f.input.write('\u001b');
      else {
        const button = f.dialog().children.find((child) => (
          (child as blessed.Widgets.BoxElement).getText() === '[Cancel]'
        )) as blessed.Widgets.BoxElement;
        f.click(button);
      }
      await expect(decision).resolves.toBeNull();
      expect(isDialogActive()).toBe(false);
      expect(f.screen.focused).toBe(f.terminal);
    } finally { f.dispose(); }
  });

  it('renders untrusted metadata literally without tags or control characters', async () => {
    const f = fixture();
    try {
      const decision = f.open([{
        ...panel(12), name: '{red-bg}Unsafe\x1b[2J\nName{/red-bg}', profileId: '\t{bold}p{/bold}',
      }]);
      const row = f.list().items[0];
      expect(row.getContent()).toContain('{red-bg}');
      expect(row.getContent()).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
      expect((row as blessed.Widgets.BoxElement & { parseTags?: boolean }).parseTags).toBeFalsy();
      f.input.write('\r');
      await expect(decision).resolves.toEqual([]);
    } finally { f.dispose(); }
  });

  it('retains selections and focused rows across small and tiny terminal resizes', async () => {
    const f = fixture();
    try {
      const decision = f.open(Array.from({ length: 100 }, (_, index) => panel(index)));
      f.input.write('\u001b[F ');
      for (const [columns, rows] of [[60, 18], [28, 10], [12, 6], [3, 3], [100, 30]]) {
        Object.assign(f.output, { columns, rows });
        Object.assign(f.screen.program, { cols: columns, rows });
        f.screen.program.emit('resize');
        f.screen.render();
        expect(Number(f.dialog().width)).toBeLessThanOrEqual(Math.max(1, columns - 2));
        expect(Number(f.dialog().height)).toBeLessThanOrEqual(Math.max(1, rows - 2));
        expect(f.list().selected).toBe(99);
        for (const child of f.dialog().children as blessed.Widgets.BoxElement[]) {
          if (child.hidden || child.type === 'text' && child.getText().includes('Commander Protocol')) continue;
          expect(Number(child.atop) + Number(child.height)).toBeLessThanOrEqual(Number(f.dialog().atop) + Number(f.dialog().height) - 1);
          expect(Number(child.aleft) + Number(child.width)).toBeLessThanOrEqual(Number(f.dialog().aleft) + Number(f.dialog().width) - 1);
        }
      }
      expect(f.list().items[99].getText()).toMatch(/^\[x\] P100/u);
      expect(f.list().selected).toBeGreaterThanOrEqual(f.list().childBase);
      expect(f.list().selected).toBeLessThan(f.list().childBase + Number(f.list().height));
      f.input.write('\r');
      await expect(decision).resolves.toEqual([99]);
    } finally { f.dispose(); }
  });

  it('reclaims stolen focus and shields application shortcuts and printable keys', async () => {
    const f = fixture();
    try {
      const decision = f.open();
      const dialog = f.dialog();
      f.terminal.focus();
      expect(f.screen.focused).toBe(dialog);
      f.input.write('text\u0010\u001b[21~\r');
      await expect(decision).resolves.toEqual([]);
      expect(f.leaked).toEqual([]);
      expect(f.shortcuts).toEqual([]);
    } finally { f.dispose(); }
  });

  it.each(['cancel', 'destroy'])('screen %s overrides an already queued selection', async (method) => {
    const f = fixture();
    try {
      const resizeListeners = f.screen.listeners('resize').length;
      const focusListeners = f.screen.listeners('element focus').length;
      const decision = f.open();
      f.input.write('a\r');
      if (method === 'destroy') f.screen.destroy();
      else closeDialogsForScreen(f.screen);
      await expect(decision).resolves.toBeNull();
      expect(isDialogActive()).toBe(false);
      expect(f.screen.grabKeys).toBe(false);
      if (method === 'cancel') {
        expect(f.screen.listeners('resize')).toHaveLength(resizeListeners);
        expect(f.screen.listeners('element focus')).toHaveLength(focusListeners);
        const next = f.open();
        f.input.write('\r');
        await expect(next).resolves.toEqual([]);
      }
    } finally { f.dispose(); }
  });

  it('ignores duplicate openings, handles no candidates, and restores previous key grabbing', async () => {
    const f = fixture();
    try {
      f.screen.grabKeys = true;
      const decision = f.open([]);
      await expect(f.open()).resolves.toBeNull();
      f.input.write('a \r');
      await expect(decision).resolves.toEqual([]);
      expect(f.screen.grabKeys).toBe(true);
    } finally { f.dispose(); }
  });

  it('cleans up safely when initial rendering throws', async () => {
    const f = fixture();
    try {
      const resizeListeners = f.screen.listeners('resize').length;
      const focusListeners = f.screen.listeners('element focus').length;
      const render = vi.spyOn(f.screen, 'render').mockImplementationOnce(() => { throw new Error('Render failed'); });
      await expect(f.open()).rejects.toThrow('Render failed');
      expect(isDialogActive()).toBe(false);
      expect(f.screen.grabKeys).toBe(false);
      expect(f.screen.focused).toBe(f.terminal);
      expect(f.screen.listeners('resize')).toHaveLength(resizeListeners);
      expect(f.screen.listeners('element focus')).toHaveLength(focusListeners);
      render.mockRestore();
      const next = f.open();
      f.input.write('\r');
      await expect(next).resolves.toEqual([]);
    } finally { f.dispose(); }
  });
});
