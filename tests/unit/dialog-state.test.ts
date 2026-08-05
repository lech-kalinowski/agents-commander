import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blessedMocks = vi.hoisted(() => ({
  box: vi.fn((options: Record<string, unknown>) => ({
    options,
    destroy: vi.fn(),
  })),
}));

vi.mock('blessed', () => ({
  default: blessedMocks,
}));

import {
  closeDialogsForScreen,
  enterDialog,
  isDialogActive,
  leaveDialog,
  registerDialogCancellation,
} from '../../src/utils/dialog-state.js';

const openScreens: any[] = [];

function createScreen() {
  const screen = new EventEmitter() as any;
  screen.focused = null;
  openScreens.push(screen);
  return screen;
}

describe('screen-scoped dialog state', () => {
  beforeEach(() => {
    blessedMocks.box.mockClear();
  });

  afterEach(() => {
    for (const screen of openScreens.splice(0)) closeDialogsForScreen(screen);
    while (isDialogActive()) leaveDialog();
  });

  it('installs a full-screen mouse shield and restores the prior focus', () => {
    const screen = createScreen();
    const previousFocus = { destroyed: false, focus: vi.fn() };
    screen.focused = previousFocus;

    enterDialog(screen);

    expect(isDialogActive()).toBe(true);
    expect(blessedMocks.box).toHaveBeenCalledWith(expect.objectContaining({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      mouse: true,
      keys: false,
      transparent: true,
    }));
    const shield = blessedMocks.box.mock.results[0].value;

    leaveDialog(screen);

    expect(shield.destroy).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
    expect(isDialogActive()).toBe(false);
  });

  it('restores a parent control before restoring the background panel', () => {
    const screen = createScreen();
    const background = { destroyed: false, focus: vi.fn() };
    const parentControl = { destroyed: false, focus: vi.fn() };
    screen.focused = background;
    enterDialog(screen);
    screen.focused = parentControl;
    enterDialog(screen);

    leaveDialog(screen);
    expect(parentControl.focus).toHaveBeenCalledOnce();
    expect(background.focus).not.toHaveBeenCalled();

    leaveDialog(screen);
    expect(background.focus).toHaveBeenCalledOnce();
    expect(isDialogActive()).toBe(false);
  });

  it('forces release when a screen cancellation hook cannot clean itself up', () => {
    const screen = createScreen();
    const previousFocus = { destroyed: false, focus: vi.fn() };
    screen.focused = previousFocus;
    enterDialog(screen);
    const shield = blessedMocks.box.mock.results[0].value;
    const cancel = vi.fn(() => {
      throw new Error('dialog cleanup failed');
    });
    registerDialogCancellation(screen, cancel);

    expect(() => closeDialogsForScreen(screen)).not.toThrow();

    expect(cancel).toHaveBeenCalledOnce();
    expect(shield.destroy).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
    expect(isDialogActive()).toBe(false);
  });

  it('cancels active dialogs automatically when the Blessed screen is destroyed', () => {
    const screen = createScreen();
    enterDialog(screen);
    const cancel = vi.fn(() => leaveDialog(screen));
    registerDialogCancellation(screen, cancel);

    screen.emit('destroy');

    expect(cancel).toHaveBeenCalledOnce();
    expect(isDialogActive()).toBe(false);
  });
});
