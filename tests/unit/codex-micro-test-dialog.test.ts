import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODEX_MICRO_BINDINGS } from '../../src/hardware/codex-micro.js';
import {
  closeDialogsForScreen,
  isDialogActive,
} from '../../src/utils/dialog-state.js';

const blessedMocks = vi.hoisted(() => ({
  box: vi.fn(),
  text: vi.fn(),
}));

vi.mock('blessed', () => ({ default: blessedMocks }));

import {
  formatCodexMicroTestContent,
  showCodexMicroTestDialog,
} from '../../src/screen/dialog/codex-micro-test-dialog.js';
import { HELP_TEXT } from '../../src/screen/dialog/help-dialog.js';

class FakeElement extends EventEmitter {
  public width: number | string;
  public height: number | string;
  public top: number | string | undefined;
  public left: number | string | undefined;
  public content: string;
  public label: string;
  public scrollOffset = 0;
  public destroyed = false;
  public readonly screen: any;

  public readonly focus = vi.fn(() => {
    this.screen.focused = this;
  });

  public readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });

  constructor(public readonly options: Record<string, any>) {
    super();
    this.width = options.width;
    this.height = options.height;
    this.top = options.top;
    this.left = options.left;
    this.content = options.content ?? '';
    this.label = options.label ?? '';
    this.screen = options.parent instanceof FakeElement
      ? options.parent.screen
      : options.parent;
  }

  setContent(content: string): void { this.content = content; }
  getScroll(): number { return this.scrollOffset; }
  setScroll(offset: number): void { this.scrollOffset = offset; }
  scroll(delta: number): void { this.scrollOffset += delta; }
  key(keys: string[], listener: (...args: any[]) => void): void {
    for (const key of keys) this.on(`key ${key}`, listener);
  }
}

function createScreen(width = 120, height = 40) {
  const screen = new EventEmitter() as any;
  screen.width = width;
  screen.height = height;
  screen.render = vi.fn();
  screen.focused = { destroyed: false, focus: vi.fn() };
  return screen;
}

const theme = {
  dialog: {
    bg: 'black',
    fg: 'white',
    border: { fg: 'cyan' },
  },
} as any;

function checklistDialog(): FakeElement {
  const result = blessedMocks.box.mock.results.find(
    ({ value }) => (value as FakeElement).label.includes('Interactive Control Test'),
  );
  if (!result) throw new Error('Codex Micro checklist was not created');
  return result.value as FakeElement;
}

describe('Codex Micro test content', () => {
  it('lists every canonical mapping and marks received semantic actions', () => {
    const tested = new Set([
      CODEX_MICRO_BINDINGS[0].action,
      CODEX_MICRO_BINDINGS[10].action,
    ]);
    const content = formatCodexMicroTestContent(tested);

    expect(CODEX_MICRO_BINDINGS).toHaveLength(13);
    for (const binding of CODEX_MICRO_BINDINGS) {
      expect(content).toContain(binding.label);
    }
    expect(content).toContain('Detected 2/13 controls');
    expect(content.match(/\[✓\]/g)).toHaveLength(2);
  });

  it('keeps the built-in help explicit about opt-in setup and all 13 controls', () => {
    for (const shortcut of [
      'Ctrl+Shift+PageUp/Down',
      'Ctrl+Shift+Home/End',
      'Ctrl+Shift+F5/F6/F7/F8',
      'Ctrl+Shift+F9',
      'Ctrl+Shift+F10',
      'Ctrl+Shift+F11/F12',
      'Ctrl+Shift+Insert',
    ]) {
      expect(HELP_TEXT).toContain(shortcut);
    }
    expect(HELP_TEXT).toContain('--codex-micro');
    expect(HELP_TEXT).toContain('--codex-micro-test');
    expect(HELP_TEXT).toContain('do not\n  enable the hardware controls automatically');
  });
});

describe('Codex Micro test dialog', () => {
  const screens: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    blessedMocks.box.mockImplementation((options) => new FakeElement(options));
    blessedMocks.text.mockImplementation((options) => new FakeElement(options));
  });

  afterEach(() => {
    for (const screen of screens.splice(0)) closeDialogsForScreen(screen);
    expect(isDialogActive()).toBe(false);
  });

  it('records controls once, resets progress, and returns the active handle', () => {
    const screen = createScreen();
    screens.push(screen);
    const handle = showCodexMicroTestDialog(screen, theme);
    const dialog = checklistDialog();

    expect(isDialogActive()).toBe(true);
    expect(showCodexMicroTestDialog(screen, theme)).toBe(handle);
    expect(handle.recordAction('next-panel')).toBe(true);
    expect(handle.recordAction('next-panel')).toBe(true);
    expect(handle.recordAction('approve')).toBe(true);
    expect(handle.testedActions()).toEqual(['next-panel', 'approve']);
    expect(dialog.content).toContain('Detected 2/13 controls');
    expect(dialog.content.match(/\[✓\]/g)).toHaveLength(2);

    screen.emit('keypress', 'r', { name: 'r', full: 'r' });
    expect(handle.testedActions()).toEqual([]);
    expect(dialog.content).toContain('Detected 0/13 controls');
  });

  it('captures every raw HID chord even when application actions are dialog-guarded', () => {
    const screen = createScreen();
    screens.push(screen);
    const handle = showCodexMicroTestDialog(screen, theme);
    const dialog = checklistDialog();

    for (const binding of CODEX_MICRO_BINDINGS) {
      screen.emit('keypress', undefined, { name: binding.key, full: binding.key });
    }

    expect(handle.testedActions()).toEqual(CODEX_MICRO_BINDINGS.map(({ action }) => action));
    expect(dialog.content).toContain('All controls detected — ready for rehearsal.');
  });

  it('closes cleanly, restores focus, and ignores later records', () => {
    const screen = createScreen();
    screens.push(screen);
    const previousFocus = screen.focused;
    const handle = showCodexMicroTestDialog(screen, theme);
    const dialog = checklistDialog();

    screen.emit('keypress', undefined, { name: 'escape', full: 'escape' });

    expect(handle.isOpen()).toBe(false);
    expect(handle.recordAction('open-activity')).toBe(false);
    expect(dialog.destroy).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
    expect(screen.listenerCount('keypress')).toBe(0);
    expect(screen.listenerCount('resize')).toBe(0);
  });

  it('reflows to a compact terminal without losing recorded progress', () => {
    const screen = createScreen(60, 14);
    screens.push(screen);
    const handle = showCodexMicroTestDialog(screen, theme);
    const dialog = checklistDialog();

    expect(dialog.width).toBe(58);
    expect(dialog.height).toBe(12);
    handle.recordAction('open-test-overlay');
    screen.width = 120;
    screen.height = 40;
    screen.emit('resize');

    expect(dialog.width).toBe(92);
    expect(dialog.height).toBe(24);
    expect(dialog.content).toContain('Detected 1/13 controls');
  });
});
