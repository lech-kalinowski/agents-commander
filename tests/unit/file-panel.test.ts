import blessed from 'blessed';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../../src/file-manager/types.js';
import { midnight } from '../../src/config/themes.js';

const mocks = vi.hoisted(() => ({
  readDirectory: vi.fn(),
  showErrorToast: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../src/file-manager/file-system.js', () => ({
  readDirectory: mocks.readDirectory,
}));

vi.mock('../../src/screen/toast.js', () => ({
  showErrorToast: mocks.showErrorToast,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: mocks.logError,
  },
}));

import { FilePanel } from '../../src/panels/file-panel.js';
import {
  enterDialog,
  isDialogActive,
  leaveDialog,
} from '../../src/utils/dialog-state.js';

const screens: blessed.Widgets.Screen[] = [];

function fileEntry(name: string, fullPath: string, isDirectory = false): FileEntry {
  return {
    name,
    fullPath,
    isDirectory,
    isSymlink: false,
    size: isDirectory ? 0 : 12,
    modified: new Date('2026-07-29T10:00:00Z'),
    permissions: isDirectory ? 'rwxr-xr-x' : 'rw-r--r--',
    extension: isDirectory ? '' : '.txt',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createScreen(): blessed.Widgets.Screen {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
  };
  input.isTTY = true;
  input.setRawMode = () => {};

  const output = new PassThrough() as PassThrough & {
    isTTY: boolean;
    columns: number;
    rows: number;
  };
  output.isTTY = true;
  output.columns = 120;
  output.rows = 30;

  const screen = blessed.screen({
    input,
    output,
    terminal: 'xterm-256color',
    smartCSR: false,
  });
  screens.push(screen);
  return screen;
}

function createPanel(initialPath = '/workspace/current', panelIndex = 0): FilePanel {
  return new FilePanel(
    createScreen(),
    midnight,
    panelIndex,
    initialPath,
    { top: 0, left: 0, width: 90, height: 24 },
  );
}

function pressEnter(panel: FilePanel): void {
  panel.list.emit('key enter');
}

afterEach(() => {
  while (isDialogActive()) leaveDialog();
  for (const screen of screens.splice(0)) {
    screen.destroy();
  }
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('FilePanel navigation', () => {
  it('does not focus the background panel while a modal dialog is active', () => {
    const panel = createPanel();
    const screen = (panel as any).screen as blessed.Widgets.Screen;
    panel.onMouseClick = vi.fn();

    panel.box.emit('click');
    expect(panel.onMouseClick).toHaveBeenCalledOnce();

    enterDialog(screen);
    panel.box.emit('click');
    expect(panel.onMouseClick).toHaveBeenCalledOnce();

    leaveDialog(screen);
    panel.box.emit('click');
    expect(panel.onMouseClick).toHaveBeenCalledTimes(2);
  });

  it('keeps the stable public panel number in its label as the path changes', async () => {
    mocks.readDirectory.mockResolvedValueOnce([]);
    const panel = createPanel('/workspace/current', 99);

    expect((panel.box as any)._label.content).toContain('P100 · /workspace/current');

    await expect(panel.loadDirectory('/workspace/next')).resolves.toBe(true);

    expect((panel.box as any)._label.content).toContain('P100 · /workspace/next');
  });

  it('updates workspace position without changing its stable protocol number', async () => {
    mocks.readDirectory.mockResolvedValue([]);
    const panel = createPanel('/workspace/current', 8);
    panel.setWorkspacePosition(1);
    expect((panel.box as any)._label.content).toContain('#1 P9 · /workspace/current');
    await panel.loadDirectory('/workspace/next');
    expect((panel.box as any)._label.content).toContain('#1 P9 · /workspace/next');
    panel.setWorkspacePosition(3);
    expect((panel.box as any)._label.content).toContain('#3 P9');
    expect(panel.panelIndex).toBe(8);
  });

  it('does not commit a candidate directory until its read succeeds', async () => {
    const original = fileEntry('old.txt', '/workspace/current/old.txt');
    mocks.readDirectory.mockResolvedValueOnce([original]);
    const panel = createPanel();
    await expect(panel.loadDirectory()).resolves.toBe(true);
    panel.focusEntry(original.fullPath);
    (panel as any).selectedFiles.add(original.fullPath);

    let resolveRead!: (entries: FileEntry[]) => void;
    mocks.readDirectory.mockImplementationOnce(
      () => new Promise<FileEntry[]>((resolve) => { resolveRead = resolve; }),
    );

    const loading = panel.loadDirectory('/workspace/next');

    expect(panel.currentPath).toBe('/workspace/current');
    expect(panel.currentEntry).toBe(original);
    expect(panel.selectedEntries).toEqual([original]);

    const next = fileEntry('next.txt', '/workspace/next/next.txt');
    resolveRead([next]);

    await expect(loading).resolves.toBe(true);
    expect(panel.currentPath).toBe('/workspace/next');
    expect(panel.currentEntry).toBeNull();
    expect(panel.selectedEntries).toEqual([]);
    expect((panel as any).entries).toEqual([next]);
  });

  it('preserves path, entries, label, selection, and cursor after a failed read', async () => {
    const original = fileEntry('old.txt', '/workspace/current/old.txt');
    mocks.readDirectory.mockResolvedValueOnce([original]);
    const panel = createPanel();
    await panel.loadDirectory();
    panel.focusEntry(original.fullPath);
    (panel as any).selectedFiles.add(original.fullPath);

    const originalEntries = (panel as any).entries;
    const originalLabel = (panel.box as any)._label.content;
    const failure = new Error('permission denied\n\x1b[31m');
    mocks.readDirectory.mockRejectedValueOnce(failure);

    const candidate = '/workspace/bad\n\x1b{red-fg}';
    await expect(panel.loadDirectory(candidate)).resolves.toBe(false);

    expect(panel.currentPath).toBe('/workspace/current');
    expect((panel as any).entries).toBe(originalEntries);
    expect((panel as any).cursorIndex).toBe(1);
    expect(panel.currentEntry).toBe(original);
    expect(panel.selectedEntries).toEqual([original]);
    expect((panel.box as any)._label.content).toBe(originalLabel);
    expect(mocks.logError).toHaveBeenCalledWith(
      `Failed to read directory: ${candidate}`,
      failure,
    );
    expect(mocks.showErrorToast).toHaveBeenCalledOnce();
    const message = mocks.showErrorToast.mock.calls[0][1] as string;
    expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  });

  it('ignores an older successful load that resolves after a newer success', async () => {
    const olderRead = deferred<FileEntry[]>();
    const newerRead = deferred<FileEntry[]>();
    mocks.readDirectory
      .mockImplementationOnce(() => olderRead.promise)
      .mockImplementationOnce(() => newerRead.promise);
    const panel = createPanel();

    const olderLoad = panel.loadDirectory('/workspace/older');
    const newerLoad = panel.loadDirectory('/workspace/newer');
    const newerEntry = fileEntry('new.txt', '/workspace/newer/new.txt');
    newerRead.resolve([newerEntry]);

    await expect(newerLoad).resolves.toBe(true);
    panel.focusEntry(newerEntry.fullPath);
    (panel as any).selectedFiles.add(newerEntry.fullPath);
    const committedEntries = (panel as any).entries;
    const committedLabel = (panel.box as any)._label.content;

    olderRead.resolve([fileEntry('old.txt', '/workspace/older/old.txt')]);
    await expect(olderLoad).resolves.toBe(false);

    expect(panel.currentPath).toBe('/workspace/newer');
    expect((panel as any).entries).toBe(committedEntries);
    expect((panel as any).cursorIndex).toBe(1);
    expect(panel.selectedEntries).toEqual([newerEntry]);
    expect((panel.box as any)._label.content).toBe(committedLabel);
    expect(mocks.showErrorToast).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('suppresses a stale failure after a newer load succeeds', async () => {
    const olderRead = deferred<FileEntry[]>();
    const newerRead = deferred<FileEntry[]>();
    mocks.readDirectory
      .mockImplementationOnce(() => olderRead.promise)
      .mockImplementationOnce(() => newerRead.promise);
    const panel = createPanel();

    const olderLoad = panel.loadDirectory('/workspace/denied');
    const newerLoad = panel.loadDirectory('/workspace/ready');
    const readyEntry = fileEntry('ready.txt', '/workspace/ready/ready.txt');
    newerRead.resolve([readyEntry]);

    await expect(newerLoad).resolves.toBe(true);
    panel.focusEntry(readyEntry.fullPath);
    (panel as any).selectedFiles.add(readyEntry.fullPath);
    const committedEntries = (panel as any).entries;
    const committedLabel = (panel.box as any)._label.content;

    olderRead.reject(new Error('late EACCES'));
    await expect(olderLoad).resolves.toBe(false);

    expect(panel.currentPath).toBe('/workspace/ready');
    expect((panel as any).entries).toBe(committedEntries);
    expect((panel as any).cursorIndex).toBe(1);
    expect(panel.selectedEntries).toEqual([readyEntry]);
    expect((panel.box as any)._label.content).toBe(committedLabel);
    expect(mocks.showErrorToast).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('invalidates a pending load when the panel is destroyed', async () => {
    const pendingRead = deferred<FileEntry[]>();
    mocks.readDirectory.mockImplementationOnce(() => pendingRead.promise);
    const panel = createPanel();

    const loading = panel.loadDirectory('/workspace/slow');
    const previousPath = panel.currentPath;
    panel.destroy();
    pendingRead.resolve([fileEntry('late.txt', '/workspace/slow/late.txt')]);

    await expect(loading).resolves.toBe(false);
    expect(panel.currentPath).toBe(previousPath);
    expect((panel as any).entries).toEqual([]);
    expect(mocks.showErrorToast).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it('opens a file exactly once without navigating and ignores a missing entry', async () => {
    const file = fileEntry('demo.txt', '/workspace/current/demo.txt');
    mocks.readDirectory.mockResolvedValueOnce([file]);
    const panel = createPanel();
    await panel.loadDirectory();
    panel.list.select(1);

    const onOpenFile = vi.fn();
    panel.onOpenFile = onOpenFile;
    pressEnter(panel);

    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith(file);
    expect(panel.currentPath).toBe('/workspace/current');
    expect(mocks.readDirectory).toHaveBeenCalledOnce();

    (panel as any).cursorIndex = 99;
    pressEnter(panel);
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(panel.currentPath).toBe('/workspace/current');
  });

  it('keeps directory and parent navigation behavior without invoking file open', async () => {
    const directory = fileEntry('child', '/workspace/current/child', true);
    mocks.readDirectory
      .mockResolvedValueOnce([directory])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([directory]);
    const panel = createPanel();
    await panel.loadDirectory();

    const onOpenFile = vi.fn();
    panel.onOpenFile = onOpenFile;
    panel.list.select(1);
    pressEnter(panel);
    await vi.waitFor(() => expect(panel.currentPath).toBe('/workspace/current/child'));

    panel.list.select(0);
    pressEnter(panel);
    await vi.waitFor(() => expect(panel.currentPath).toBe('/workspace/current'));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('keeps the current directory selection when Enter navigation fails', async () => {
    const directory = fileEntry('denied', '/workspace/current/denied', true);
    mocks.readDirectory
      .mockResolvedValueOnce([directory])
      .mockRejectedValueOnce(new Error('EACCES'));
    const panel = createPanel();
    await panel.loadDirectory();
    panel.list.select(1);

    pressEnter(panel);
    await vi.waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledOnce());

    expect(panel.currentPath).toBe('/workspace/current');
    expect(panel.currentEntry).toBe(directory);
    expect((panel as any).cursorIndex).toBe(1);
  });

  it('neutralizes control characters and Blessed tags in names and labels', async () => {
    const maliciousName = 'bad\n\x1b{red-fg}owned{/red-fg}.txt';
    const candidate = '/workspace/\x1b{blue-bg}unsafe{/blue-bg}';
    mocks.readDirectory.mockResolvedValueOnce([
      fileEntry(maliciousName, `${candidate}/${maliciousName}`),
    ]);
    const panel = createPanel('/workspace/current');

    await panel.loadDirectory(candidate);

    const rowContent = (panel.list as any).ritems[1] as string;
    const labelContent = (panel.box as any)._label.content as string;
    expect(rowContent).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(labelContent).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(rowContent).not.toContain('{red-fg}owned');
    expect(labelContent).not.toContain('{blue-bg}unsafe');
    expect(rowContent).toContain('{open}red-fg{close}');
    expect(labelContent).toContain('{open}blue-bg{close}');
  });

  it('keeps directory state current while hidden and synchronizes the latest view when shown', async () => {
    const original = fileEntry('old.txt', '/workspace/current/old.txt');
    mocks.readDirectory.mockResolvedValueOnce([original]);
    const panel = createPanel();
    await panel.loadDirectory();
    panel.setFocus(true);
    vi.useFakeTimers();

    const screen = (panel as any).screen as blessed.Widgets.Screen;
    const render = vi.spyOn(screen, 'render');
    const rewindFocus = vi.spyOn(screen, 'rewindFocus');
    const setItems = vi.spyOn(panel.list, 'setItems');
    const select = vi.spyOn(panel.list, 'select');
    const setLabel = vi.spyOn(panel.box, 'setLabel');

    panel.setVisible(false);

    expect(panel.isVisible).toBe(false);
    expect(panel.box.hidden).toBe(true);
    expect(rewindFocus).toHaveBeenCalledOnce();
    vi.runOnlyPendingTimers();

    render.mockClear();
    setItems.mockClear();
    select.mockClear();
    setLabel.mockClear();

    const latest = fileEntry('latest.txt', '/workspace/latest/latest.txt');
    mocks.readDirectory.mockResolvedValueOnce([latest]);
    await expect(panel.loadDirectory('/workspace/latest')).resolves.toBe(true);
    panel.focusEntry(latest.fullPath);
    panel.resize({ top: 1, left: 2, width: 70, height: 20 });

    expect(panel.currentPath).toBe('/workspace/latest');
    expect(panel.currentEntry).toBe(latest);
    expect(setItems).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(setLabel).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    panel.setVisible(true);
    vi.runOnlyPendingTimers();

    expect(panel.isVisible).toBe(true);
    expect(panel.box.hidden).toBe(false);
    expect(setLabel).toHaveBeenCalledOnce();
    expect(setItems).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledOnce();
    expect((panel.list as any).ritems[1]).toContain('latest.txt');
    expect((panel.box as any)._label.content).toContain('P1 · /workspace/latest');
    expect(screen.focused).toBe(panel.list);
  });
});
