import { describe, expect, it } from 'vitest';
import { buildVimLaunchSpec, resolveCtrlGAction } from '../../src/utils/shortcut-routing.js';

describe('resolveCtrlGAction', () => {
  it('opens Vim for a selected file on a file panel', () => {
    expect(resolveCtrlGAction({
      activePanel: 'file',
      hasSelectedFile: true,
      terminalRunning: false,
    })).toBe('open-vim');
  });

  it('passes Ctrl+G through to a running terminal session', () => {
    expect(resolveCtrlGAction({
      activePanel: 'terminal',
      hasSelectedFile: false,
      terminalRunning: true,
    })).toBe('pass-through');
  });

  it('falls back to the guide when no file is selected', () => {
    expect(resolveCtrlGAction({
      activePanel: 'file',
      hasSelectedFile: false,
      terminalRunning: false,
    })).toBe('show-guide');
  });
});

describe('buildVimLaunchSpec', () => {
  it('builds a vim command for the selected file', () => {
    expect(buildVimLaunchSpec('/tmp/notes.md')).toEqual({
      label: 'Vim: notes.md',
      command: 'vim',
      args: ['/tmp/notes.md'],
    });
  });
});
