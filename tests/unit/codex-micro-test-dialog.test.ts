import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODEX_MICRO_BINDINGS,
  CODEX_MICRO_NATIVE_BINDINGS,
} from '../../src/hardware/codex-micro.js';
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

  it('lists factory controls and safely presents live native-device metadata', () => {
    const testedInputs = new Set(['AG00', 'ACT10'] as const);
    const content = formatCodexMicroTestContent(new Set(), {
      inputMode: 'native',
      testedInputs,
      deviceStatus: {
        state: 'connected',
        transport: 'usb',
        connectionEpoch: 'not-rendered',
        firmware: 'v0.4.1{red-fg}',
        battery: 72.6,
        charging: true,
        detail: '{red-fg}ready{/red-fg}\u001b[31m',
      },
      lastHardwareInput: { input: 'ACT10', action: 'open-activity' },
    });

    for (const binding of CODEX_MICRO_NATIVE_BINDINGS) {
      expect(content).toContain(binding.input);
    }
    expect(content).toContain('Connected');
    expect(content).toContain('USB');
    expect(content).toContain('firmware v0.4.1 red-fg');
    expect(content).toContain('battery 73% (charging)');
    expect(content).toContain('Detected 2/19 physical controls');
    expect(content).toContain('Decision actions: disabled');
    expect(content).toContain('Last input: ACT10 → Activity');
    expect(content).not.toContain('{red-fg}ready');
    expect(content).not.toContain('not-rendered');
  });

  it('teaches native controls first and labels keyboard programming as fallback', () => {
    for (const copy of [
      'no Work Louder reprogramming is required',
      'Input Monitoring',
      'Agent keys 1–6',
      'Panel navigator (same destination as F11)',
      'Approve/Reject',
      '--codex-micro-decisions',
      '--codex-micro-keyboard',
    ]) {
      expect(HELP_TEXT).toContain(copy);
    }
    expect(HELP_TEXT).toContain('--codex-micro');
    expect(HELP_TEXT).toContain('--codex-micro-test');
    expect(HELP_TEXT).toContain('do not enable hardware automatically');
    expect(HELP_TEXT).not.toContain('Program the device in');
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

  it('tracks direct hardware controls, live status, and keeps native mode exclusive', () => {
    const screen = createScreen();
    screens.push(screen);
    const handle = showCodexMicroTestDialog(screen, theme, {
      inputMode: 'native',
      decisionControls: false,
      initialStatus: {
        state: 'disconnected',
        transport: 'unknown',
        connectionEpoch: null,
      },
    });
    const dialog = checklistDialog();

    expect(dialog.height).toBe(30);
    expect(dialog.content).toContain('Waiting for device');
    expect(dialog.content).toContain('Detected 0/19 physical controls');
    expect(dialog.content).toContain('Approve/Reject are input-test only');

    screen.emit('keypress', undefined, {
      name: CODEX_MICRO_BINDINGS[0].key,
      full: CODEX_MICRO_BINDINGS[0].key,
    });
    expect(handle.testedActions()).toEqual([]);

    expect(handle.recordHardwareInput('AG00', 'focus-panel-1')).toBe(true);
    expect(handle.recordHardwareInput('ACT10', 'open-activity')).toBe(true);
    expect(handle.recordHardwareInput('ACT11', 'approve')).toBe(false);
    expect(handle.testedInputs()).toEqual(['AG00', 'ACT10']);
    expect(handle.testedActions()).toEqual(['focus-panel-1', 'open-activity']);
    expect(dialog.content).toContain('Detected 2/19 physical controls');
    expect(dialog.content).toContain('Last input: ACT10 → Activity');

    handle.setDeviceStatus({
      state: 'connected',
      transport: 'bluetooth',
      connectionEpoch: 'ephemeral-epoch',
      firmware: 'v0.4.1',
      battery: 88,
    });
    expect(dialog.content).toContain('Connected');
    expect(dialog.content).toContain('Bluetooth');
    expect(dialog.content).toContain('firmware v0.4.1');
    expect(dialog.content).toContain('battery 88%');
    expect(dialog.content).not.toContain('ephemeral-epoch');

    screen.emit('keypress', 'r', { name: 'r', full: 'r' });
    expect(handle.testedActions()).toEqual([]);
    expect(handle.testedInputs()).toEqual([]);
    expect(dialog.content).toContain('Detected 0/19 physical controls');
    expect(dialog.content).toContain('Connected');
    expect(dialog.content).toContain('Last input: none yet');
  });

  it('completes the native checklist from all factory reports, coalescing the wide key', () => {
    const screen = createScreen();
    screens.push(screen);
    const handle = showCodexMicroTestDialog(screen, theme, {
      inputMode: 'native',
      decisionControls: true,
    });
    const dialog = checklistDialog();

    for (const binding of CODEX_MICRO_NATIVE_BINDINGS) {
      expect(handle.recordHardwareInput(binding.input, binding.action)).toBe(true);
    }

    expect(handle.testedInputs()).toHaveLength(CODEX_MICRO_NATIVE_BINDINGS.length);
    expect(dialog.content).toContain('All physical controls detected — ready for rehearsal.');
    expect(dialog.content.match(/\[✓\]/g)).toHaveLength(19);
    expect(dialog.scrollOffset).toBeGreaterThan(0);
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
