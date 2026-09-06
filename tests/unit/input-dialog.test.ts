import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blessedMocks = vi.hoisted(() => ({
  box: vi.fn(),
  text: vi.fn(),
  textbox: vi.fn(),
}));

vi.mock('blessed', () => ({
  default: blessedMocks,
}));

import { showInputDialog } from '../../src/screen/dialog/input-dialog.js';
import {
  closeDialogsForScreen,
  isDialogActive,
} from '../../src/utils/dialog-state.js';

class FakeElement extends EventEmitter {
  public width: number | string;
  public height: number | string;
  public top: number | string;
  public left: number | string;
  public readonly options: Record<string, any>;
  public readonly screen: any;
  public readonly destroy = vi.fn();
  public readonly focus = vi.fn(() => {
    this.screen.focused = this;
  });

  constructor(options: Record<string, any>) {
    super();
    this.options = options;
    this.width = options.width;
    this.height = options.height;
    this.top = options.top;
    this.left = options.left;
    this.screen = options.parent instanceof FakeElement
      ? options.parent.screen
      : options.parent;
  }
}

const screens: any[] = [];

function createScreen() {
  const screen = new EventEmitter() as any;
  screen.width = 100;
  screen.height = 30;
  screen.render = vi.fn();
  screen.focused = {
    destroyed: false,
    focus: vi.fn(),
  };
  screens.push(screen);
  return screen;
}

function inputDialogBox(): FakeElement {
  const result = blessedMocks.box.mock.results.find(
    ({ value }) => (value as FakeElement).options.label?.includes('Rename'),
  );
  if (!result) throw new Error('Input dialog was not created');
  return result.value as FakeElement;
}

const theme = {
  dialog: {
    bg: 'black',
    fg: 'white',
    border: { fg: 'cyan' },
  },
} as any;

describe('Input dialog disposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blessedMocks.box.mockImplementation((options) => new FakeElement(options));
    blessedMocks.text.mockImplementation((options) => new FakeElement(options));
    blessedMocks.textbox.mockImplementation((options) => new FakeElement(options));
  });

  afterEach(() => {
    for (const screen of screens.splice(0)) closeDialogsForScreen(screen);
  });

  it('settles on screen disposal, restores focus, and permits the next dialog', async () => {
    const screen = createScreen();
    const previousFocus = screen.focused;
    const first = showInputDialog(screen, theme, 'Rename', 'New name:');

    expect(isDialogActive()).toBe(true);
    expect(screen.listenerCount('resize')).toBe(1);
    closeDialogsForScreen(screen);

    await expect(first).resolves.toBeNull();
    expect(isDialogActive()).toBe(false);
    expect(screen.listenerCount('resize')).toBe(0);
    expect(previousFocus.focus).toHaveBeenCalledOnce();

    const second = showInputDialog(screen, theme, 'Rename', 'New name:');
    const input = blessedMocks.textbox.mock.results.at(-1)!.value as FakeElement;
    input.emit('submit', 'ready.txt');

    await expect(second).resolves.toBe('ready.txt');
    expect(isDialogActive()).toBe(false);
  });

  it('still settles and releases modal state when widget destruction throws', async () => {
    const screen = createScreen();
    const pending = showInputDialog(screen, theme, 'Rename', 'New name:');
    inputDialogBox().destroy.mockImplementationOnce(() => {
      throw new Error('destroy failed');
    });

    expect(() => closeDialogsForScreen(screen)).not.toThrow();

    await expect(pending).resolves.toBeNull();
    expect(isDialogActive()).toBe(false);
    expect(screen.listenerCount('resize')).toBe(0);
  });

  it('keeps the modal shield until submit key dispatch finishes', async () => {
    const screen = createScreen();
    const pending = showInputDialog(screen, theme, 'Rename', 'New name:');
    const input = blessedMocks.textbox.mock.results.at(-1)!.value as FakeElement;
    input.emit('submit', '1');
    expect(isDialogActive()).toBe(true);
    await expect(pending).resolves.toBe('1');
    expect(isDialogActive()).toBe(false);
  });

  it('does not dismiss a newer dialog when an already-submitted dialog is disposed', async () => {
    const screen = createScreen();
    const first = showInputDialog(screen, theme, 'Rename', 'First:');
    (blessedMocks.textbox.mock.results.at(-1)!.value as FakeElement).emit('submit', '1');
    closeDialogsForScreen(screen);
    const second = showInputDialog(screen, theme, 'Rename', 'Second:');
    await expect(first).resolves.toBe('1');
    expect(isDialogActive()).toBe(true);
    (blessedMocks.textbox.mock.results.at(-1)!.value as FakeElement).emit('cancel');
    await expect(second).resolves.toBeNull();
    expect(isDialogActive()).toBe(false);
  });
});
