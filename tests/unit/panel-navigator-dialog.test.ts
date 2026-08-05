import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDialogActive } from '../../src/utils/dialog-state.js';

const blessedMocks = vi.hoisted(() => ({
  box: vi.fn(),
  textbox: vi.fn(),
  list: vi.fn(),
  text: vi.fn(),
}));

vi.mock('blessed', () => ({
  default: blessedMocks,
}));

import {
  filterPanelSummaries,
  formatPanelSummary,
  showPanelNavigatorDialog,
  sortPanelSummaries,
  type PanelSummary,
} from '../../src/screen/dialog/panel-navigator-dialog.js';

class FakeElement extends EventEmitter {
  public width: number | string;
  public height: number | string;
  public top: number | string | undefined;
  public left: number | string | undefined;
  public content: string;
  public value: string;
  public label: string;
  public items: string[];
  public selected = 0;
  public destroyed = false;
  public readonly options: Record<string, any>;
  public readonly screen: any;

  public readonly focus = vi.fn(() => {
    this.screen.focused = this;
  });

  public readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });

  constructor(options: Record<string, any>) {
    super();
    this.options = options;
    this.width = options.width;
    this.height = options.height;
    this.top = options.top;
    this.left = options.left;
    this.content = options.content ?? '';
    this.value = options.value ?? '';
    this.label = options.label ?? '';
    this.items = [...(options.items ?? [])];
    this.screen = options.parent instanceof FakeElement
      ? options.parent.screen
      : options.parent;
  }

  setContent(content: string): void { this.content = content; }
  setValue(value: string): void { this.value = value; }
  getValue(): string { return this.value; }
  setLabel(label: string): void { this.label = label; }
  setItems(items: string[]): void { this.items = [...items]; }
  select(index: number): void { this.selected = index; }
}

function createScreen(width = 120, height = 40) {
  const screen = new EventEmitter() as any;
  screen.width = width;
  screen.height = height;
  screen.render = vi.fn();
  screen.key = vi.fn((keys: string[], listener: (...args: any[]) => void) => {
    for (const key of keys) screen.on(`key ${key}`, listener);
  });
  screen.unkey = vi.fn((keys: string | string[], listener: (...args: any[]) => void) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      screen.removeListener(`key ${key}`, listener);
    }
  });
  screen.focused = {
    destroyed: false,
    focus: vi.fn(),
  };
  return screen;
}

function panel(
  panelNumber: number,
  overrides: Partial<PanelSummary> = {},
): PanelSummary {
  return {
    panelId: panelNumber * 100,
    panelNumber,
    title: `Panel ${panelNumber}`,
    kind: 'terminal',
    status: 'running',
    cwd: `/repo/panel-${panelNumber}`,
    ...overrides,
  };
}

const theme = {
  dialog: {
    bg: 'black',
    fg: 'white',
    border: { fg: 'cyan' },
  },
} as any;

function navigatorDialog(): FakeElement {
  const result = blessedMocks.box.mock.results.find(
    ({ value }) => (value as FakeElement).label.includes('Panel Navigator'),
  );
  if (!result) throw new Error('Panel Navigator dialog was not created');
  return result.value as FakeElement;
}

describe('panel navigator pure helpers', () => {
  it('sorts deterministically without mutating the source', () => {
    const source = [
      panel(12, { panelId: 1201, title: 'Zulu' }),
      panel(2),
      panel(12, { panelId: 1200, title: 'Alpha' }),
    ];
    const snapshot = [...source];

    expect(sortPanelSummaries(source).map((item) => item.panelId))
      .toEqual([200, 1200, 1201]);
    expect(source).toEqual(snapshot);
  });

  it('supports multi-digit panel numbers and every searchable metadata field', () => {
    const panels = [
      panel(2, { title: 'Docs' }),
      panel(12, {
        title: 'Auth review',
        agent: 'OpenCode',
        model: 'Qwen 3',
        status: 'waiting',
        cwd: '/work/api',
      }),
    ];

    expect(filterPanelSummaries(panels, '12').map((item) => item.panelNumber))
      .toEqual([12]);
    expect(filterPanelSummaries(panels, 'p12').map((item) => item.panelNumber))
      .toEqual([12]);
    expect(filterPanelSummaries(panels, 'auth opencode qwen waiting /work/api'))
      .toEqual([panels[1]]);
  });

  it('formats a safe bounded row with optional model and unread state', () => {
    const formatted = formatPanelSummary(panel(12, {
      title: 'Unsafe\x1b[2J\nTitle',
      agent: 'OpenCode',
      model: 'Qwen 3',
      unreadCount: 4,
    }), 80);

    expect(formatted).toContain('P12');
    expect(formatted).toContain('OpenCode');
    expect(formatted).toContain('Qwen 3');
    expect(formatted).toContain('unread:4');
    expect(formatted).not.toContain('\x1b');
    expect(formatted.length).toBeLessThanOrEqual(80);
  });
});

describe('Panel Navigator dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blessedMocks.box.mockImplementation((options) => new FakeElement(options));
    blessedMocks.textbox.mockImplementation((options) => new FakeElement(options));
    blessedMocks.list.mockImplementation((options) => new FakeElement(options));
    blessedMocks.text.mockImplementation((options) => new FakeElement(options));
  });

  afterEach(() => {
    expect(isDialogActive()).toBe(false);
  });

  it('searches a multi-digit number, returns stable panelId, and restores focus', async () => {
    const screen = createScreen();
    const previousFocus = screen.focused;
    const promise = showPanelNavigatorDialog(
      screen,
      theme,
      [panel(1), panel(12, { panelId: 987654, title: 'Target' })],
      100,
    );
    const dialog = navigatorDialog();
    const input = blessedMocks.textbox.mock.results[0].value as FakeElement;
    const list = blessedMocks.list.mock.results[0].value as FakeElement;

    expect(isDialogActive()).toBe(true);
    screen.emit('keypress', '1', { name: '1', full: '1' });
    screen.emit('keypress', '2', { name: '2', full: '2' });

    expect(input.value).toBe('12');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toContain('P12');
    screen.emit('keypress', undefined, { name: 'enter', full: 'enter' });

    await expect(promise).resolves.toBe(987654);
    expect(dialog.destroy).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
    expect(screen.listenerCount('keypress')).toBe(0);
    expect(screen.listenerCount('resize')).toBe(0);
  });

  it('moves by a visible page and resolves the selected stable id', async () => {
    const screen = createScreen(80, 16);
    const panels = Array.from({ length: 12 }, (_, index) => panel(index + 1));
    const promise = showPanelNavigatorDialog(screen, theme, panels, 100);
    const list = blessedMocks.list.mock.results[0].value as FakeElement;

    // At 16 terminal rows the responsive list is six rows high, so PageDown
    // advances five entries from P1 to P6.
    expect(list.height).toBe(6);
    screen.emit('keypress', undefined, { name: 'pagedown', full: 'pagedown' });
    expect(list.selected).toBe(5);
    screen.emit('keypress', undefined, { name: 'enter', full: 'enter' });

    await expect(promise).resolves.toBe(600);
  });

  it('resizes responsively and Escape cancels with listener-safe cleanup', async () => {
    const screen = createScreen(60, 14);
    const previousFocus = screen.focused;
    const promise = showPanelNavigatorDialog(screen, theme, [panel(1)]);
    const dialog = navigatorDialog();

    expect(dialog.width).toBe(58);
    expect(dialog.height).toBe(12);
    screen.width = 120;
    screen.height = 40;
    screen.render.mockClear();
    screen.emit('resize');
    expect(dialog.width).toBe(92);
    expect(dialog.height).toBe(26);
    expect(screen.render).toHaveBeenCalledOnce();

    screen.emit('keypress', undefined, { name: 'escape', full: 'escape' });
    await expect(promise).resolves.toBeNull();

    expect(previousFocus.focus).toHaveBeenCalledOnce();
    expect(screen.listenerCount('keypress')).toBe(0);
    expect(screen.listenerCount('resize')).toBe(0);
  });

  it('closes on the later named F11 event without handling raw F11 keypress', async () => {
    const screen = createScreen();
    const promise = showPanelNavigatorDialog(screen, theme, [panel(1)]);

    screen.emit('keypress', undefined, { name: 'f11', full: 'f11' });
    expect(isDialogActive()).toBe(true);
    screen.emit('key f11');

    await expect(promise).resolves.toBeNull();
    expect(screen.listenerCount('key f11')).toBe(0);
  });
});
