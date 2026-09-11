import blessed from 'blessed';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/defaults.js';
import { midnight } from '../../src/config/themes.js';
import type { FileEntry } from '../../src/file-manager/types.js';

const mocks = vi.hoisted(() => ({ readDirectory: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('../../src/file-manager/file-system.js', () => ({ readDirectory: mocks.readDirectory }));
vi.mock('../../src/screen/toast.js', () => ({ showErrorToast: mocks.showErrorToast }));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { FilePanel } from '../../src/panels/file-panel.js';
import { LayoutManager } from '../../src/screen/layout-manager.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
  return { promise, resolve, reject };
}

const harnesses: Array<{ screen: blessed.Widgets.Screen; layout: LayoutManager; input: PassThrough; output: PassThrough }> = [];

async function createHarness() {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 120, rows: 35 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const layout = new LayoutManager(screen, midnight, structuredClone(defaultConfig));
  const harness = { screen, layout, input, output };
  harnesses.push(harness);
  mocks.readDirectory.mockResolvedValue([]);
  await layout.initialize('/synthetic-workspace', 2, 2);
  return harness;
}

afterEach(() => {
  for (const { screen, layout, input, output } of harnesses.splice(0)) {
    for (const panel of layout.allPanels) panel.destroy();
    screen.destroy();
    input.destroy();
    output.destroy();
  }
  vi.clearAllMocks();
});

describe('deep lifecycle release QA', () => {
  it('does not cancel an in-flight user navigation when automatic refresh overlaps it', async () => {
    const { layout } = await createHarness();
    const panel = layout.activeFilePanel!;
    const committedRoots: string[][] = [];
    layout.onFileDirectoryChanged = () => {
      committedRoots.push(layout.filePanels.map((item) => item.currentPath));
    };
    const navigationRead = deferred<FileEntry[]>();
    mocks.readDirectory.mockImplementation((directory: string) => directory === '/synthetic-workspace/next'
      ? navigationRead.promise
      : Promise.resolve([]));

    const navigating = panel.loadDirectory('/synthetic-workspace/next');
    const refreshing = layout.refreshAll();
    // Directory is only committed after its read succeeds.
    expect(panel.currentPath).toBe('/synthetic-workspace');
    navigationRead.resolve([]);
    await Promise.all([navigating, refreshing]);

    expect(panel.currentPath).toBe('/synthetic-workspace/next');
    expect(committedRoots).toEqual([['/synthetic-workspace/next', '/synthetic-workspace']]);
    expect(mocks.readDirectory.mock.calls.filter(([directory]) => directory === '/synthetic-workspace/next')).toHaveLength(1);
    expect(mocks.showErrorToast).not.toHaveBeenCalled();
  });

  it.each(['old-first', 'new-first'] as const)(
    'keeps the latest explicit navigation when an older navigation settles %s',
    async (order) => {
      const { layout } = await createHarness();
      const panel = layout.activeFilePanel!;
      const first = deferred<FileEntry[]>();
      const second = deferred<FileEntry[]>();
      const changed = vi.fn();
      layout.onFileDirectoryChanged = changed;
      mocks.readDirectory.mockImplementation((directory: string) => directory === '/synthetic-workspace/first'
        ? first.promise
        : second.promise);

      const firstNavigation = panel.loadDirectory('/synthetic-workspace/first');
      const firstRefresh = panel.loadDirectory();
      const secondNavigation = panel.loadDirectory('/synthetic-workspace/second');
      const secondRefresh = panel.loadDirectory();
      expect(firstRefresh).toBe(firstNavigation);
      expect(secondRefresh).toBe(secondNavigation);
      if (order === 'old-first') {
        first.resolve([]);
        await firstNavigation;
        expect(panel.currentPath).toBe('/synthetic-workspace');
        expect(panel.loadDirectory()).toBe(secondNavigation);
        second.resolve([]);
      } else {
        second.resolve([]);
        await secondNavigation;
        first.resolve([]);
      }
      await expect(firstNavigation).resolves.toBe(false);
      await expect(secondNavigation).resolves.toBe(true);
      expect(panel.currentPath).toBe('/synthetic-workspace/second');
      expect(changed).toHaveBeenCalledOnce();
    },
  );

  it('settles a failed navigation and its shared refresh once, then permits a fresh refresh', async () => {
    const { layout } = await createHarness();
    const panel = layout.activeFilePanel!;
    const read = deferred<FileEntry[]>();
    mocks.readDirectory.mockImplementationOnce(() => read.promise);
    const changed = vi.fn();
    layout.onFileDirectoryChanged = changed;
    const navigation = panel.loadDirectory('/synthetic-workspace/missing');
    const refresh = panel.loadDirectory();
    read.reject(Object.assign(new Error('Synthetic directory disappeared'), { code: 'ENOENT' }));
    await expect(navigation).resolves.toBe(false);
    await expect(refresh).resolves.toBe(false);
    expect(mocks.showErrorToast).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    expect(panel.currentPath).toBe('/synthetic-workspace');
    await expect(panel.loadDirectory()).resolves.toBe(true);
  });

  it('applies an explicit hidden-file toggle to the pending destination without returning to the old directory', async () => {
    const { layout } = await createHarness();
    const panel = layout.activeFilePanel!;
    const originalRead = deferred<FileEntry[]>();
    const changedFilterRead = deferred<FileEntry[]>();
    const changed = vi.fn();
    layout.onFileDirectoryChanged = changed;
    mocks.readDirectory.mockReset();
    mocks.readDirectory.mockImplementation((_directory: string, showHidden: boolean) => showHidden
      ? changedFilterRead.promise
      : originalRead.promise);

    const originalNavigation = panel.loadDirectory('/synthetic-workspace/next');
    panel.toggleHidden();
    const latestNavigation = panel.loadDirectory();
    expect(mocks.readDirectory.mock.calls).toEqual([
      ['/synthetic-workspace/next', false],
      ['/synthetic-workspace/next', true],
    ]);
    changedFilterRead.resolve([]);
    await expect(latestNavigation).resolves.toBe(true);
    originalRead.resolve([]);
    await expect(originalNavigation).resolves.toBe(false);
    expect(panel.currentPath).toBe('/synthetic-workspace/next');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('keeps a burst of refresh requests to one active directory read per visible panel', async () => {
    const { layout } = await createHarness();
    const pending = deferred<FileEntry[]>();
    let active = 0;
    let maximum = 0;
    mocks.readDirectory.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await pending.promise;
      active--;
      return [];
    });
    const refreshes = Array.from({ length: 100 }, () => layout.refreshAll());
    expect(active).toBe(2);
    pending.resolve([]);
    await Promise.all(refreshes);
    expect(maximum).toBe(2);
    expect(active).toBe(0);
  });

  it('does not commit an old read after its panel is closed and a new panel is allocated', async () => {
    const { layout } = await createHarness();
    const retired = layout.activeFilePanel!;
    const read = deferred<FileEntry[]>();
    mocks.readDirectory.mockImplementationOnce(() => read.promise);
    const pending = retired.loadDirectory('/synthetic-workspace/retired');
    const refresh = retired.loadDirectory();
    expect(layout.removePanel(retired.panelIndex)).toBe(true);
    await layout.addPanel('/synthetic-workspace/replacement');
    read.resolve([]);

    await expect(pending).resolves.toBe(false);
    await expect(refresh).resolves.toBe(false);
    await expect(retired.loadDirectory()).resolves.toBe(false);
    expect(layout.allPanels).not.toContain(retired);
    expect(layout.activePanel).toBeInstanceOf(FilePanel);
    expect((layout.activePanel as FilePanel).currentPath).toBe('/synthetic-workspace/replacement');
    expect(mocks.showErrorToast).not.toHaveBeenCalled();
  });
});
