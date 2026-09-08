import { PassThrough } from 'node:stream';
import blessed from 'blessed';
import { describe, expect, it, vi } from 'vitest';
import { getTheme } from '../../src/config/themes.js';
import { showProtocolBatchProgress } from '../../src/screen/dialog/protocol-batch-progress.js';
import { closeDialogsForScreen, isDialogActive } from '../../src/utils/dialog-state.js';

function fixture(columns = 100, rows = 30) {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns, rows });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const terminal = blessed.box({ parent: screen, keys: true, input: true });
  const leaked: string[] = [];
  terminal.on('keypress', (_ch, key) => leaked.push(key.name));
  terminal.focus();
  return {
    input, output, screen, terminal, leaked,
    open(total = 16) { return showProtocolBatchProgress(screen, getTheme('midnight'), total); },
    dispose() {
      closeDialogsForScreen(screen);
      screen.destroy();
      input.destroy();
      output.destroy();
    },
  };
}

describe('protocol batch progress', () => {
  it('renders completion and outcome counts with stable one-based panel numbers', () => {
    const f = fixture();
    try {
      const progress = f.open();
      expect(progress.cancelled).toBe(false);
      expect(f.screen.focused.getContent()).toContain('Completed 0 of 16 panels.');
      expect(f.screen.focused.getContent()).toContain('Submitted: 0  Skipped: 0  Failed: 0');
      expect(f.screen.focused.getContent()).not.toContain('Current panel:');
      progress.update(7, 4, 2, 1, 19);
      expect(f.screen.focused.getContent()).toContain('Completed 7 of 16 panels.');
      expect(f.screen.focused.getContent()).toContain('Submitted: 4  Skipped: 2  Failed: 1');
      expect(f.screen.focused.getContent()).toContain('Current panel: P20');
      progress.update(8, 5, 2, 1, 0);
      expect(f.screen.focused.getContent()).toContain('Current panel: P1');
      progress.update(16, 12, 3, 1);
      expect(f.screen.focused.getContent()).not.toContain('Current panel:');
      progress.close();
      expect(progress.cancelled).toBe(false);
    } finally { f.dispose(); }
  });

  it('retains its input shield after Esc until the caller closes it', () => {
    const f = fixture();
    try {
      const progress = f.open();
      const dialog = f.screen.focused;
      const shield = f.screen.children[f.screen.children.indexOf(dialog) - 1];
      f.screen.program.emit('keypress', undefined, { name: 'escape', full: 'escape' });
      expect(progress.cancelled).toBe(true);
      expect(isDialogActive()).toBe(true);
      expect(dialog.getContent()).toContain('Stopping remaining submissions');
      expect(shield.detached).not.toBe(true);
      progress.update(3, 2, 1, 0, 5);
      f.input.write('\r\tN20\u001b[B\u0010');
      expect(dialog.getContent()).toContain('Completed 3 of 16');
      expect(dialog.getContent()).toContain('Stopping remaining submissions');
      expect(f.leaked).toEqual([]);
      progress.close();
      progress.close();
      expect(isDialogActive()).toBe(false);
      expect(shield.detached).toBe(true);
      expect(f.screen.focused).toBe(f.terminal);
      expect(f.screen.grabKeys).toBe(false);
    } finally { f.dispose(); }
  });

  it('contains parser keys and reclaims focus from background panels', () => {
    const f = fixture();
    try {
      const shortcuts = vi.fn();
      f.screen.key(['enter', 'tab', 'C-p', 'f2'], shortcuts);
      const progress = f.open();
      const dialog = f.screen.focused;
      f.terminal.focus();
      expect(f.screen.focused).toBe(dialog);
      f.input.write('\r\t\u0010\u001bOQabc');
      expect(f.leaked).toEqual([]);
      expect(shortcuts).not.toHaveBeenCalled();
      expect(f.screen.focused).toBe(dialog);
      progress.close();
      f.input.write('x');
      expect(f.leaked).toEqual(['x']);
    } finally { f.dispose(); }
  });

  it.each(['cancel', 'destroy'] as const)('cleans up on screen %s and ignores stale updates', action => {
    const f = fixture();
    try {
      const priorResize = [...f.screen.listeners('resize')];
      const priorFocus = [...f.screen.listeners('element focus')];
      const priorEscape = [...f.screen.listeners('key escape')];
      const progress = f.open();
      const dialog = f.screen.focused;
      if (action === 'destroy') f.screen.destroy();
      else closeDialogsForScreen(f.screen);
      expect(progress.cancelled).toBe(true);
      expect(dialog.detached).toBe(true);
      expect(isDialogActive()).toBe(false);
      expect(f.screen.grabKeys).toBe(false);
      expect(f.screen.listeners('resize')).toEqual(priorResize);
      expect(f.screen.listeners('element focus')).toEqual(priorFocus);
      expect(f.screen.listeners('key escape')).toEqual(priorEscape);
      expect(() => { progress.update(4, 2, 1, 1, 99); progress.close(); }).not.toThrow();
    } finally { f.dispose(); }
  });

  it('preserves pre-existing grabbed input and unrelated Esc handlers on close', () => {
    const f = fixture();
    try {
      const escape = vi.fn();
      f.screen.key(['escape'], escape);
      f.screen.grabKeys = true;
      const progress = f.open();
      progress.close();
      expect(f.screen.grabKeys).toBe(true);
      expect(f.screen.listeners('key escape')).toContain(escape);
      expect(f.screen.focused).toBe(f.terminal);
    } finally { f.dispose(); }
  });

  it('stays bounded through resize and tiny terminal dimensions', () => {
    const f = fixture(12, 5);
    try {
      const progress = f.open(100);
      const dialog = f.screen.focused;
      progress.update(31, 20, 7, 4, 99);
      for (const [columns, rows] of [[100, 30], [40, 12], [12, 5], [2, 2], [1, 1], [100, 30]]) {
        Object.assign(f.output, { columns, rows });
        Object.assign(f.screen.program, { cols: columns, rows });
        expect(() => {
          f.screen.program.emit('resize');
          f.screen.render();
        }).not.toThrow();
        expect(Number(dialog.width)).toBeLessThanOrEqual(Math.max(1, columns - 2));
        expect(Number(dialog.height)).toBeLessThanOrEqual(Math.max(1, rows - 2));
        expect(Number(dialog.width)).toBeGreaterThanOrEqual(1);
        expect(Number(dialog.height)).toBeGreaterThanOrEqual(1);
        expect(f.screen.focused).toBe(dialog);
        expect(dialog.getContent()).toContain('Completed 31 of 100 panels.');
        expect(dialog.getContent()).toContain('Current panel: P100');
      }
      progress.close();
    } finally { f.dispose(); }
  });

  it.each(['initial', 'update'] as const)('releases input and modal state after an %s render error', stage => {
    const f = fixture();
    try {
      const priorResize = [...f.screen.listeners('resize')];
      const priorFocus = [...f.screen.listeners('element focus')];
      const progress = stage === 'update' ? f.open() : undefined;
      const render = vi.spyOn(f.screen, 'render').mockImplementation(() => { throw new Error('render failed'); });
      try {
        expect(() => {
          if (progress) progress.update(1, 1, 0, 0);
          else f.open();
        }).toThrow('render failed');
        expect(isDialogActive()).toBe(false);
        expect(f.screen.grabKeys).toBe(false);
        expect(f.screen.focused).toBe(f.terminal);
        expect(f.screen.children).toEqual([f.terminal]);
        expect(f.screen.listeners('resize')).toEqual(priorResize);
        expect(f.screen.listeners('element focus')).toEqual(priorFocus);
        if (progress) expect(progress.cancelled).toBe(true);
      } finally { render.mockRestore(); }
    } finally { f.dispose(); }
  });
});
