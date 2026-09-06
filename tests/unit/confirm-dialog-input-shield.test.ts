import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showConfirmDialog } from '../../src/screen/dialog/confirm-dialog.js';
import { isDialogActive } from '../../src/utils/dialog-state.js';

function terminalStream(columns: number, rows: number): PassThrough {
  const stream = new PassThrough();
  Object.assign(stream, {
    isTTY: true,
    columns,
    rows,
    setRawMode: vi.fn(),
  });
  return stream;
}

describe('confirmation dialog terminal input shield', () => {
  it.each([
    { name: 'Up chooses Yes', keys: '\u001b[A', answer: true },
    { name: 'Down chooses No', keys: '\u001b[A\u001b[B', answer: false },
    { name: 'repeated Left keeps Yes selected', keys: '\u001b[D\u001b[D', answer: true },
    { name: 'Right keeps No selected', keys: '\u001b[C', answer: false },
    { name: 'Tab chooses Yes', keys: '\t', answer: true },
    { name: 'Shift+Tab chooses Yes', keys: '\u001b[Z', answer: true },
  ])('$name without sending keys to the terminal', async ({ keys, answer }) => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const leakedKeys: string[] = [];
    terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
    terminal.focus();
    try {
      const decision = showConfirmDialog(screen, getTheme('midnight'), 'Replace Session', 'Replace the running APEX profile?');
      const dialog = screen.focused;
      input.write(keys);
      expect(screen.focused).toBe(dialog);
      expect(isDialogActive()).toBe(true);
      input.write('\r');
      await expect(decision).resolves.toBe(answer);
      expect(screen.focused).toBe(terminal);
      expect(leakedKeys).toEqual([]);
    } finally {
      screen.destroy(); input.destroy(); output.destroy();
    }
  });

  it.each([true, false])('activates the %s choice through real terminal mouse input', async (answer) => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const terminal = blessed.box({ parent: screen, keys: true, mouse: true });
    const leakedClick = vi.fn();
    terminal.on('click', leakedClick);
    terminal.focus();
    try {
      const decision = showConfirmDialog(screen, getTheme('midnight'), 'Replace Session', 'Replace the running APEX profile?');
      const dialog = screen.focused as blessed.Widgets.BoxElement;
      const button = dialog.children.find((child) => {
        const text = (child as blessed.Widgets.BoxElement).getText();
        return answer ? /Yes/u.test(text) : /\bNo\b/u.test(text);
      }) as blessed.Widgets.BoxElement;
      expect(button).toBeDefined();
      const x = Number(button.aleft) + 3;
      const y = Number(button.atop) + 1;
      let resolved: boolean | undefined;
      void decision.then((value) => { resolved = value; });
      input.write(`\u001b[<0;${x};${y}M`);
      input.write(`\u001b[<0;${x};${y}m`);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(resolved).toBe(answer);
      expect(screen.focused).toBe(terminal);
      expect(leakedClick).not.toHaveBeenCalled();
    } finally {
      screen.destroy(); input.destroy(); output.destroy();
    }
  });

  it.each([
    { name: 'right-click', externalConfirmOnly: false, mouseButton: 2 },
    { name: 'terminal click on a device-only approval', externalConfirmOnly: true, mouseButton: 0 },
  ])('does not approve through $name', async ({ externalConfirmOnly, mouseButton }) => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const terminal = blessed.box({ parent: screen, keys: true, mouse: true });
    terminal.focus();
    try {
      const decision = showConfirmDialog(screen, getTheme('midnight'), 'Guarded choice', 'Confirm this action?', { externalConfirmOnly });
      const dialog = screen.focused as blessed.Widgets.BoxElement;
      const button = dialog.children.find((child) => /Yes|Device/u.test((child as blessed.Widgets.BoxElement).getText())) as blessed.Widgets.BoxElement;
      const x = Number(button.aleft) + 3;
      const y = Number(button.atop) + 1;
      let settled = false;
      void decision.then(() => { settled = true; });
      input.write(`\u001b[<${mouseButton};${x};${y}M`);
      input.write(`\u001b[<${mouseButton};${x};${y}m`);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(screen.focused).toBe(dialog);
      expect(isDialogActive()).toBe(true);
      input.write('n');
      await expect(decision).resolves.toBe(false);
      expect(screen.focused).toBe(terminal);
    } finally {
      screen.destroy(); input.destroy(); output.destroy();
    }
  });

  it('contains Blessed synthetic enter plus return before restoring terminal focus', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const programKeys: string[] = [];
    const leakedKeys: string[] = [];
    screen.program.on('keypress', (_character, key) => {
      programKeys.push(key.name);
    });
    terminal.on('keypress', (_character, key) => {
      leakedKeys.push(key.name);
    });
    terminal.focus();

    try {
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Guarded decision',
        'Default No must not leak Enter to the terminal.',
      );
      input.write('\r');

      await expect(decision).resolves.toBe(false);
      expect(programKeys).toEqual(['enter', 'return']);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });

  it('accepts a trusted external confirmation without leaking terminal input', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const leakedKeys: string[] = [];
    terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
    terminal.focus();

    try {
      let confirm!: () => void;
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Hardware confirmation',
        'A second validated device press confirms this action.',
        {
          externalConfirmOnly: true,
          onReady: (controller) => { confirm = controller.confirm; },
        },
      );
      confirm();

      await expect(decision).resolves.toBe(true);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });

  it('ignores keyboard approval in external-only mode but permits keyboard cancellation', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const leakedKeys: string[] = [];
    terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
    terminal.focus();

    try {
      let settled = false;
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Hardware confirmation',
        'Only a second validated device press may confirm.',
        { externalConfirmOnly: true },
      );
      void decision.then(() => { settled = true; });

      input.write('y');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      input.write('n');
      await expect(decision).resolves.toBe(false);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });

  it('keeps keyboard selection on No in external-only mode', async () => {
    const input = terminalStream(100, 30);
    const output = terminalStream(100, 30);
    const screen = blessed.screen({
      input,
      output,
      terminal: 'xterm-256color',
      smartCSR: false,
    });
    const terminal = blessed.box({ parent: screen, keys: true, input: true });
    const leakedKeys: string[] = [];
    terminal.on('keypress', (_character, key) => leakedKeys.push(key.name));
    terminal.focus();

    try {
      const decision = showConfirmDialog(
        screen,
        getTheme('midnight'),
        'Hardware confirmation',
        'Arrow keys cannot select keyboard approval.',
        { externalConfirmOnly: true },
      );
      input.write('\u001b[C');
      input.write('\r');

      await expect(decision).resolves.toBe(false);
      expect(leakedKeys).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      screen.destroy();
      input.destroy();
      output.destroy();
    }
  });
});
