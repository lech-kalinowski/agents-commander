import blessed from 'blessed';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { isDialogActive } from '../../src/utils/dialog-state.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() },
}));
vi.mock('../../src/file-manager/file-watcher.js', () => ({
  startWatching: vi.fn(), stopWatching: vi.fn(),
}));
vi.mock('../../src/config/loader.js', async () => {
  const { defaultConfig } = await import('../../src/config/defaults.js');
  return { loadConfig: () => structuredClone(defaultConfig) };
});

import { App } from '../../src/app.js';
import { FilePanel } from '../../src/panels/file-panel.js';
import { startWatching } from '../../src/file-manager/file-watcher.js';

async function createHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-workspace-qa-'));
  await fs.writeFile(path.join(root, 'synthetic.md'), '# Synthetic workspace\n');
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 160, rows: 44 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const screenFactory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
  const app: any = new App(root, { skipWelcome: true, panels: 100, density: 'auto', codexMicro: false });
  const dispose = async () => {
    try {
      await app.dispose();
    } finally {
      screenFactory.mockRestore();
      input.destroy();
      output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
  try {
    await app.run();
    return { app, screen, input, root, dispose,
      resize(columns: number, rows: number) {
        Object.assign(output, { columns, rows });
        Object.assign(screen.program, { cols: columns, rows });
        screen.program.emit('resize');
        screen.render();
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

describe('real Blessed hundred-panel workspace', () => {
  it('reconciles only current file-panel directories after navigation and closing', async () => {
    const h = await createHarness();
    try {
      const nested = path.join(h.root, 'nested');
      await fs.mkdir(nested);
      const firstPanel = h.app.layout.activeFilePanel as FilePanel;
      await firstPanel.loadDirectory(nested);
      const requested = vi.mocked(startWatching).mock.lastCall?.[0];
      expect(requested).toContain(nested);
      expect(requested).toContain(h.root);
      h.input.write('\x1b[20~');
      await vi.waitFor(() => expect(h.app.layout.panelCount).toBe(99));
      expect(vi.mocked(startWatching).mock.lastCall?.[0]).not.toContain(nested);
      expect(new Set(vi.mocked(startWatching).mock.lastCall?.[0])).toEqual(new Set([h.root]));
    } finally {
      await h.dispose();
    }
  });

  it('resizes, jumps, reorders, closes and replaces panels without changing surviving stable IDs', async () => {
    const h = await createHarness();
    const { app, input } = h;
    const initial = [...app.layout.allPanels] as FilePanel[];
    const initialIds = initial.map((panel) => panel.panelIndex);
    try {
      expect(initialIds).toEqual(Array.from({ length: 100 }, (_, index) => index));
      expect(initial.every((panel) => panel instanceof FilePanel)).toBe(true);
      expect(app.layout.availablePanelCapacity).toBe(0);
      expect(app.agentManager.getRunningAgents()).toEqual([]);
      expect(app.layout.visiblePanelIds).toEqual(initialIds.slice(0, 16));

      for (const [columns, rows] of [[80, 24], [20, 8], [1, 1], [240, 70]]) {
        h.resize(columns, rows);
        expect(app.layout.allPanels).toEqual(initial);
        expect(app.layout.visiblePanelIds).toContain(app.layout.activePanelId);
        expect(app.layout.visiblePanels.length).toBeLessThanOrEqual(100);
        for (const panel of app.layout.visiblePanels) {
          expect(Number(panel.box.width)).toBeGreaterThanOrEqual(1);
          expect(Number(panel.box.width)).toBeLessThanOrEqual(columns);
          expect(Number(panel.box.height)).toBeGreaterThanOrEqual(1);
          expect(Number(panel.box.height)).toBeLessThanOrEqual(rows);
        }
      }

      input.write('\x1b[23~'); // F11.
      await vi.waitFor(() => expect(isDialogActive()).toBe(true));
      input.write('P100\r');
      await vi.waitFor(() => expect(app.layout.activePanelId).toBe(99));
      expect(isDialogActive()).toBe(false);
      expect(app.layout.getPanel(99)).toBe(initial[99]);
      expect(app.layout.visiblePanelIds).toContain(99);

      const beforeFullscreen = [...app.layout.visiblePanelIds];
      input.write('\x1bOS'); // F4.
      expect(app.layout.isFullscreen).toBe(true);
      expect(app.layout.visiblePanelIds).toEqual([99]);
      h.resize(20, 8);
      expect(app.layout.isFullscreen).toBe(true);
      expect(app.layout.visiblePanelIds).toEqual([99]);
      h.resize(240, 70);
      input.write('\x1bOS');
      expect(app.layout.isFullscreen).toBe(false);
      expect(app.layout.visiblePanelIds).toEqual(beforeFullscreen);

      input.write('\x1b[18~'); // F7; move current P100 to workspace position #1.
      await vi.waitFor(() => expect(h.screen.focused?.type).toBe('textbox'));
      // Blessed installs textbox editing on setImmediate after focus.
      await vi.waitFor(() => expect(typeof (h.screen.focused as any).__listener).toBe('function'));
      input.write('\x7f\x7f\x7f1\r');
      await vi.waitFor(() => expect(app.layout.workspacePanelIds[0]).toBe(99));
      expect(app.layout.activePanelId).toBe(99);
      expect(app.layout.getPanel(99)).toBe(initial[99]);
      expect(app.layout.workspacePanelIds).toEqual([99, ...initialIds.slice(0, 99)]);
      await vi.waitFor(() => expect(app.destructiveTransitionInProgress).toBe(false));
      expect(h.screen.grabKeys).toBe(false);

      input.write('\x1b[23~');
      await vi.waitFor(() => expect(isDialogActive()).toBe(true));
      input.write('P50\r');
      await vi.waitFor(() => expect(app.layout.activePanelId).toBe(49));
      input.write('\x1b[20~'); // F9 closes only P50, not its directory or files.
      await vi.waitFor(() => expect(app.layout.panelCount).toBe(99));
      expect(app.layout.hasPanel(49)).toBe(false);
      expect(await fs.readFile(path.join(h.root, 'synthetic.md'), 'utf8')).toBe('# Synthetic workspace\n');
      expect(app.layout.workspacePanelIds).not.toContain(49);
      for (const panel of initial.filter((panel) => panel.panelIndex !== 49)) {
        expect(app.layout.getPanel(panel.panelIndex)).toBe(panel);
      }

      input.write('\x1bOR'); // F3 allocates P101, without reusing removed P50.
      await vi.waitFor(() => expect(app.layout.panelCount).toBe(100));
      expect(app.layout.activePanelId).toBe(100);
      expect(app.layout.availablePanelCapacity).toBe(0);
      expect(app.layout.workspacePanelIds).not.toContain(49);
      expect(new Set(app.layout.workspacePanelIds).size).toBe(100);
      expect(app.agentManager.getRunningAgents()).toEqual([]);
      expect(isDialogActive()).toBe(false);
    } finally {
      await h.dispose();
    }
    expect(isDialogActive()).toBe(false);
  }, 20000);
});
