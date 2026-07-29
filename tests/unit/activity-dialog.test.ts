import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageRecord } from '../../src/orchestration/message-ledger.js';
import { isDialogActive } from '../../src/utils/dialog-state.js';

const blessedMocks = vi.hoisted(() => ({
  box: vi.fn(),
  text: vi.fn(),
}));

vi.mock('blessed', () => ({
  default: blessedMocks,
}));

import {
  formatRoutedActivity,
  showActivityDialog,
  type ActivityDialogHandle,
} from '../../src/screen/dialog/activity-dialog.js';

class FakeElement extends EventEmitter {
  public width: number | string;
  public height: number | string;
  public destroyed = false;
  public content: string;
  public scrollOffset = 0;
  public readonly screen: any;
  public readonly options: Record<string, any>;

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
    this.content = options.content ?? '';
    this.screen = options.parent instanceof FakeElement
      ? options.parent.screen
      : options.parent;
  }

  key(keys: string[], handler: (...args: any[]) => void): void {
    for (const key of keys) {
      this.on(`key ${key}`, handler);
    }
  }

  setContent(content: string): void {
    this.content = content;
  }

  getScroll(): number {
    return this.scrollOffset;
  }

  setScroll(offset: number): void {
    this.scrollOffset = offset;
  }

  scroll(delta: number): void {
    this.scrollOffset += delta;
  }
}

function createScreen() {
  const screen = new EventEmitter() as any;
  screen.width = 120;
  screen.height = 40;
  screen.render = vi.fn();
  screen.focused = {
    destroyed: false,
    focus: vi.fn(),
  };
  return screen;
}

function message(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    messageId: 'msg_000001',
    threadId: 'thr_000001',
    kind: 'send',
    source: {
      sessionId: 'claude-session',
      panelIndex: 0,
      agentName: 'Claude Code',
      agentType: 'claude',
    },
    target: {
      sessionId: 'codex-session',
      panelIndex: 1,
      agentName: 'Codex CLI',
      agentType: 'codex',
    },
    content: 'Review the change',
    createdAt: Date.UTC(2026, 6, 29, 10, 0, 0),
    updatedAt: Date.UTC(2026, 6, 29, 10, 0, 1),
    status: 'delivered',
    replyToMessageId: null,
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

describe('Activity dialog', () => {
  let handle: ActivityDialogHandle | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    blessedMocks.box.mockReset();
    blessedMocks.text.mockReset();
    blessedMocks.box.mockImplementation((options) => new FakeElement(options));
    blessedMocks.text.mockImplementation((options) => new FakeElement(options));
  });

  afterEach(() => {
    handle?.close();
    handle = null;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('renders only routed messages and sanitizes untrusted fields', () => {
    const formatted = formatRoutedActivity([
      message({
        source: {
          sessionId: 'source',
          panelIndex: 0,
          agentName: '{red-fg}Bad\x1b[31m\nAgent{/red-fg}',
          agentType: 'claude',
        },
        content: `unsafe\x1b[2J\n${'x'.repeat(300)}`,
      }),
      message({
        messageId: 'msg_status',
        kind: 'status',
        content: 'live status must not appear',
      }),
    ], 70);

    expect(formatted).toContain('SEND');
    expect(formatted).toContain('{red-fg}Bad [31m Agent{/red-fg}');
    expect(formatted).not.toContain('\x1b');
    expect(formatted).not.toContain('live status must not appear');
    expect(formatted).toContain('…');
  });

  it('shows an explicit empty state without implying STATUS or QUERY history', () => {
    const formatted = formatRoutedActivity([
      message({ kind: 'query', content: 'agents' }),
    ]);

    expect(formatted).toContain('No routed messages yet');
    expect(formatted).toContain('SEND, REPLY, and BROADCAST');
    expect(formatted).toContain('STATUS and QUERY are live-only');
  });

  it('enforces one open dialog and uses tags:false for dynamic content', () => {
    const screen = createScreen();
    const provider = vi.fn(() => [message()]);

    handle = showActivityDialog(screen, theme, provider, { refreshIntervalMs: 250 });
    const duplicate = showActivityDialog(screen, theme, provider);
    const dialog = blessedMocks.box.mock.results[0].value as FakeElement;
    const footer = blessedMocks.text.mock.results[0].value as FakeElement;

    expect(handle).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(isDialogActive()).toBe(true);
    expect(blessedMocks.box).toHaveBeenCalledOnce();
    expect(dialog.options.tags).toBe(false);
    expect(footer.options.tags).toBe(false);
    expect(dialog.options.label).toContain('SEND / REPLY / BROADCAST');
  });

  it('refreshes live content and cleans listeners, timer, dialog state, and focus once', () => {
    const screen = createScreen();
    const previousFocus = screen.focused;
    const records: MessageRecord[] = [];
    const provider = vi.fn(() => records);

    handle = showActivityDialog(screen, theme, provider, { refreshIntervalMs: 250 });
    const dialog = blessedMocks.box.mock.results[0].value as FakeElement;

    expect(provider).toHaveBeenCalledOnce();
    expect(screen.listenerCount('keypress')).toBe(1);
    expect(screen.listenerCount('resize')).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(dialog.content).toContain('No routed messages yet');

    records.push(message({ content: 'Live refresh arrived' }));
    vi.advanceTimersByTime(250);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(dialog.content).toContain('Live refresh arrived');

    handle.close();
    handle.close();

    expect(isDialogActive()).toBe(false);
    expect(screen.listenerCount('keypress')).toBe(0);
    expect(screen.listenerCount('resize')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(dialog.destroy).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
  });

  it('closes on F12 without treating Shift+F12 as the Activity toggle', async () => {
    const screen = createScreen();
    handle = showActivityDialog(screen, theme, () => []);
    const dialog = blessedMocks.box.mock.results[0].value as FakeElement;

    screen.emit('keypress', undefined, {
      name: 'f12',
      full: 'S-f12',
      shift: true,
    });
    await Promise.resolve();
    expect(dialog.destroy).not.toHaveBeenCalled();

    screen.emit('keypress', undefined, {
      name: 'f12',
      full: 'f12',
      shift: false,
    });
    await Promise.resolve();
    expect(dialog.destroy).toHaveBeenCalledOnce();
  });

  it('removes a partially attached dialog when initial rendering throws', () => {
    const screen = createScreen();
    const previousFocus = screen.focused;
    screen.render.mockImplementationOnce(() => {
      throw new TypeError('initial render failed');
    });

    expect(() => showActivityDialog(screen, theme, () => []))
      .toThrow('initial render failed');

    const dialog = blessedMocks.box.mock.results[0].value as FakeElement;
    expect(dialog.destroy).toHaveBeenCalledOnce();
    expect(isDialogActive()).toBe(false);
    expect(screen.listenerCount('keypress')).toBe(0);
    expect(screen.listenerCount('resize')).toBe(0);
    expect(previousFocus.focus).toHaveBeenCalledOnce();

    handle = showActivityDialog(screen, theme, () => []);
    expect(handle).not.toBeNull();
  });

  it('restores dialog state and listeners even when destroy reports an error', () => {
    const screen = createScreen();
    const previousFocus = screen.focused;
    handle = showActivityDialog(screen, theme, () => []);
    const dialog = blessedMocks.box.mock.results[0].value as FakeElement;
    dialog.destroy.mockImplementationOnce(() => {
      throw new TypeError('destroy failed');
    });

    expect(() => handle?.close()).toThrow('destroy failed');

    expect(isDialogActive()).toBe(false);
    expect(screen.listenerCount('keypress')).toBe(0);
    expect(screen.listenerCount('resize')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(previousFocus.focus).toHaveBeenCalledOnce();

    handle = showActivityDialog(screen, theme, () => []);
    expect(handle).not.toBeNull();
  });
});
