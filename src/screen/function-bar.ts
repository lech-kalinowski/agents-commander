import blessed from 'blessed';
import type { Theme } from '../config/types.js';

export interface FunctionBarKey {
  num: number;
  label: string;
}

const DEFAULT_KEYS: FunctionBarKey[] = [
  { num: 1, label: 'Help' },
  { num: 2, label: 'Agent' },
  { num: 3, label: '+Panel' },
  { num: 4, label: 'View' },
  { num: 5, label: 'Edit' },
  { num: 6, label: 'Copy' },
  { num: 7, label: 'Move' },
  { num: 8, label: 'Mkdir' },
  { num: 9, label: 'Delete' },
  { num: 10, label: 'Quit' },
];

export function createFunctionBar(parent: blessed.Widgets.Screen, theme: Theme): blessed.Widgets.BoxElement {
  const bar = blessed.box({
    parent,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: {
      bg: theme.functionBar.bg,
      fg: theme.functionBar.fg,
    },
  });

  updateFunctionBar(bar, DEFAULT_KEYS, theme);
  return bar;
}

export function updateFunctionBar(
  bar: blessed.Widgets.BoxElement,
  keys: FunctionBarKey[],
  theme: Theme,
): void {
  const keyBg = theme.functionBar.key.bg;
  const keyFg = theme.functionBar.key.fg;
  const labelBg = theme.functionBar.bg;
  const labelFg = theme.functionBar.fg;

  const parts = keys.map(
    (k) =>
      `{${keyBg}-fg}{${keyFg}-bg}${k.num}{/${keyFg}-bg}{/${keyBg}-fg}` +
      `{${labelBg}-fg}{${labelFg}-bg}${k.label.padEnd(5)}{/${labelFg}-bg}{/${labelBg}-fg}`,
  );

  // Simpler approach with tag formatting
  const content = keys
    .map((k) => `{black-bg}{white-fg}${k.num >= 10 ? k.num : ' ' + k.num}{/white-fg}{/black-bg}{cyan-bg}{black-fg}${k.label.padEnd(6)}{/black-fg}{/cyan-bg}`)
    .join('');

  bar.setContent(content);
}
