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
vi.mock('../../src/file-manager/file-watcher.js', () => ({ startWatching: vi.fn(), stopWatching: vi.fn() }));
vi.mock('../../src/config/loader.js', async () => {
  const { defaultConfig } = await import('../../src/config/defaults.js');
  return { loadConfig: () => structuredClone(defaultConfig) };
});

import { App } from '../../src/app.js';
import { EditorFileIO } from '../../src/editor/editor-file-io.js';
import { FilePanel } from '../../src/panels/file-panel.js';

const keys = {
  f1: '\x1bOP', f2: '\x1bOQ', f3: '\x1bOR', f4: '\x1bOS',
  f5: '\x1b[15~', f6: '\x1b[17~', f7: '\x1b[18~', f8: '\x1b[19~',
  f9: '\x1b[20~', f10: '\x1b[21~', f11: '\x1b[23~', f12: '\x1b[24~',
};

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-deep-keyboard-'));
  const file = path.join(root, 'synthetic.md');
  await fs.mkdir(path.join(root, 'child'));
  await fs.writeFile(file, '# Synthetic keyboard test\n');
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 150, rows: 44 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const factory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
  const app: any = new App(root, { skipWelcome: true, panels: 2, density: 2, codexMicro: false });
  const dispose = async () => {
    try { await app.dispose(); }
    finally {
      factory.mockRestore();
      input.destroy(); output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
  try { await app.run(); }
  catch (error) { await dispose(); throw error; }
  return {
    root, file, input, output, screen, app, dispose,
    async ready() {
      await vi.waitFor(() => {
        expect(app.destructiveTransitionInProgress).toBe(false);
        expect(isDialogActive()).toBe(false);
        expect(app.fullScreenOverlayActive).toBe(false);
      });
    },
    async escape() {
      input.write('\x1b');
      await vi.waitFor(() => expect(isDialogActive()).toBe(false));
    },
    async textbox() {
      await vi.waitFor(() => {
        expect(screen.focused.type).toBe('textbox');
        expect(typeof (screen.focused as any).__listener).toBe('function');
      });
    },
    resize(columns: number, rows: number) {
      Object.assign(output, { columns, rows });
      Object.assign(screen.program, { cols: columns, rows });
      screen.program.emit('resize');
      screen.render();
    },
  };
}

describe('real Blessed release keyboard QA', () => {
  it('runs every function-key workflow and returns focus after modal cancellation', async () => {
    const h = await fixture();
    try {
      for (const key of [keys.f1, keys.f2, keys.f11, keys.f12]) {
        const focus = h.screen.focused;
        h.input.write(key);
        expect(isDialogActive()).toBe(true);
        const modalFocus = h.screen.focused;
        h.resize(50, 16);
        expect(h.screen.focused).toBe(modalFocus);
        h.resize(150, 44);
        expect(h.screen.focused).toBe(modalFocus);
        await h.escape();
        expect(h.screen.focused).toBe(focus);
        expect(h.screen.grabKeys).toBe(false);
      }

      h.input.write(keys.f3);
      await h.ready();
      expect(h.app.layout.panelCount).toBe(3);
      const addedId = h.app.layout.activePanelId;
      h.input.write(keys.f4);
      expect(h.app.layout.isFullscreen).toBe(true);
      h.input.write(keys.f4);
      expect(h.app.layout.isFullscreen).toBe(false);

      h.input.write(keys.f6);
      await h.ready();
      expect(h.app.layout.panelCount).toBe(4);
      const clonedId = h.app.layout.activePanelId;
      expect(clonedId).not.toBe(addedId);
      expect(h.app.agentManager.getRunningAgents()).toEqual([]);
      h.input.write(keys.f7);
      await h.textbox();
      h.input.write('\x7f1\r');
      await h.ready();
      expect(h.app.layout.workspacePanelIds[0]).toBe(clonedId);
      expect(h.app.layout.activePanelId).toBe(clonedId);

      h.input.write(keys.f8);
      await h.textbox();
      h.input.write('created-by-keyboard\r');
      await h.ready();
      await vi.waitFor(async () => expect((await fs.stat(path.join(h.root, 'created-by-keyboard'))).isDirectory()).toBe(true));
      const panel = h.app.layout.activeFilePanel as FilePanel;
      panel.focusEntry(h.file);
      h.input.write(keys.f5);
      await vi.waitFor(() => expect((h.screen.focused as any).children.some((child: any) => child.getText?.().includes('Edit: synthetic.md'))).toBe(true));
      expect(h.app.fullScreenOverlayActive).toBe(true);
      await h.escape();
      await h.ready();
      expect(await fs.readFile(h.file, 'utf8')).toBe('# Synthetic keyboard test\n');

      h.input.write(keys.f9);
      await h.ready();
      expect(h.app.layout.panelCount).toBe(3);
      expect(h.app.layout.hasPanel(clonedId)).toBe(false);
      expect(await fs.readFile(h.file, 'utf8')).toBe('# Synthetic keyboard test\n');
      h.input.write(keys.f10);
      expect(isDialogActive()).toBe(true);
      h.input.write('\x1b[D\x1b[C\r'); // Select Yes, then No; Enter cancels.
      await h.ready();
      expect(h.app.disposalStarted).toBe(false);
      expect(h.screen.focused).toBe(h.app.layout.activeFilePanel.list);
      h.input.write('\t');
      expect(h.screen.focused).toBe(h.app.layout.activeFilePanel.list);
    } finally { await h.dispose(); }
  }, 20000);

  it.each([
    { name: 'Esc then a late successful read', cancel: '\x1b', failRead: false },
    { name: 'Ctrl+Q then a late failed read', cancel: '\x11', failRead: true },
  ])('keeps editor loading cancellable with $name', async ({ cancel, failRead }) => {
    const h = await fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const load = EditorFileIO.prototype.load;
    const delayedLoad = vi.spyOn(EditorFileIO.prototype, 'load').mockImplementation(async function (this: EditorFileIO, filePath) {
      await pending;
      if (failRead) throw new Error('Synthetic delayed read failure');
      return load.call(this, filePath);
    });
    try {
      const panel = h.app.layout.activeFilePanel as FilePanel;
      panel.focusEntry(h.file);
      const selected = panel.currentEntry;
      h.input.write(keys.f5);
      expect(delayedLoad).toHaveBeenCalledOnce();
      expect(isDialogActive()).toBe(true);
      h.input.write('\x1b[A');
      expect(panel.currentEntry).toBe(selected);
      h.input.write(cancel);
      await h.ready();
      expect(h.screen.focused).toBe(panel.list);
      h.input.write(keys.f1);
      const replacementModal = h.screen.focused;
      expect(isDialogActive()).toBe(true);
      const readFinished = delayedLoad.mock.results[0].value as Promise<unknown>;
      release();
      await readFinished.catch(() => {});
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(isDialogActive()).toBe(true);
      expect(h.screen.focused === replacementModal, 'Late editor loading must not replace the new dialog').toBe(true);
      await h.escape();
      expect(h.screen.focused).toBe(panel.list);
      expect(await fs.readFile(h.file, 'utf8')).toBe('# Synthetic keyboard test\n');
    } finally {
      release();
      delayedLoad.mockRestore();
      await h.dispose();
    }
  });

  it('contains rapid global shortcut bursts inside modal dialogs and keeps later input usable', async () => {
    const h = await fixture();
    try {
      for (let cycle = 0; cycle < 12; cycle++) {
        h.input.write(keys.f1);
        expect(isDialogActive()).toBe(true);
        h.input.write(keys.f3 + keys.f6 + keys.f9 + keys.f2 + '\t');
        expect(h.app.layout.panelCount).toBe(2);
        expect(h.app.layout.activePanelId).toBe(cycle % 2);
        await h.escape();
        expect(h.screen.grabKeys).toBe(false);
        h.input.write('\t');
        expect(h.app.layout.activePanelId).toBe((cycle + 1) % 2);
        expect(h.screen.focused).toBe(h.app.layout.activeFilePanel.list);
      }
      expect(h.app.agentManager.getRunningAgents()).toEqual([]);
      expect(await fs.readFile(h.file, 'utf8')).toBe('# Synthetic keyboard test\n');
    } finally { await h.dispose(); }
  });

  it('keeps a dialog navigable when Vim exits and restores its file panel in the background', async () => {
    const h = await fixture();
    try {
      h.app.layout.convertToTerminal(0);
      h.input.write(keys.f2);
      expect(isDialogActive()).toBe(true);
      const modalFocus = h.screen.focused;
      // Exercise the exact callback used on Vim process exit without launching
      // a user's editor or any external agent CLI.
      await h.app.restoreFilePanelAfterVim(0, h.root, h.file);
      expect(h.screen.focused === modalFocus, 'Background conversion must preserve dialog focus').toBe(true);
      await h.escape();
      expect(h.screen.focused).toBe(h.app.layout.activeFilePanel.list);
      h.input.write(keys.f11);
      expect(isDialogActive()).toBe(true);
      await h.escape();
    } finally { await h.dispose(); }
  });
});
