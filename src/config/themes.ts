import type { Theme } from './types.js';

export const classicBlue: Theme = {
  name: 'Classic Blue',
  panel: {
    bg: 'blue',
    fg: 'white',
    border: { fg: 'cyan' },
    borderFocus: { fg: 'bright-cyan' },
    header: { bg: 'cyan', fg: 'black' },
    selected: { bg: 'cyan', fg: 'yellow' },
    cursor: { bg: 'cyan', fg: 'black' },
    directory: { fg: 'white' },
    executable: { fg: 'green' },
  },
  functionBar: {
    bg: 'cyan',
    fg: 'black',
    key: { bg: 'black', fg: 'white' },
  },
  statusBar: { bg: 'blue', fg: 'white' },
  menuBar: { bg: 'cyan', fg: 'black' },
  dialog: { bg: 'white', fg: 'black', border: { fg: 'black' } },
  editor: {
    bg: 'blue',
    fg: 'white',
    lineNumber: { fg: 'cyan' },
    cursor: { bg: 'cyan', fg: 'black' },
  },
};

export const midnight: Theme = {
  name: 'Midnight',
  panel: {
    bg: 'black',
    fg: 'white',
    border: { fg: 'blue' },
    borderFocus: { fg: 'bright-blue' },
    header: { bg: 'blue', fg: 'white' },
    selected: { bg: 'blue', fg: 'yellow' },
    cursor: { bg: 'blue', fg: 'white' },
    directory: { fg: 'cyan' },
    executable: { fg: 'green' },
  },
  functionBar: {
    bg: 'blue',
    fg: 'white',
    key: { bg: 'black', fg: 'cyan' },
  },
  statusBar: { bg: 'black', fg: 'cyan' },
  menuBar: { bg: 'blue', fg: 'white' },
  dialog: { bg: 'black', fg: 'white', border: { fg: 'blue' } },
  editor: {
    bg: 'black',
    fg: 'white',
    lineNumber: { fg: 'blue' },
    cursor: { bg: 'blue', fg: 'white' },
  },
};

export const themes: Record<string, Theme> = {
  'classic-blue': classicBlue,
  midnight,
};

export function getTheme(name: string): Theme {
  return themes[name] ?? classicBlue;
}
