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
  return { loadConfig: () => ({
    ...structuredClone(defaultConfig),
    agentProfiles: [{
      id: 'synthetic-panel-test', adapter: 'generic', label: 'Synthetic panel test',
      command: process.execPath,
      args: ['-e', "console.log('PANEL_READY'); process.stdin.resume(); setInterval(() => {}, 1000);"],
      env: {},
    }],
  }) };
});

import { App } from '../../src/app.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';

describe('real Blessed panel controls with synthetic PTY sessions', () => {
  it.skipIf(process.platform === 'win32')('resizes, clones, reorders and closes the intended session through actual key input', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-panel-controls-'));
    const keptFile = path.join(root, 'keep.txt');
    await fs.writeFile(keptFile, 'F9 closes panels, not files.');
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 120, rows: 32 });
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const screenFactory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
    const app: any = new App(root, { skipWelcome: true, density: 2 });
    try {
      await app.run();
      const source = app.layout.convertToTerminal(0) as TerminalPanel;
      expect(app.agentManager.launchProfile('synthetic-panel-test', source)).toBe(true);
      app.orchestrator.connectPanel(source);
      app.layout.setActivePanel(0);
      app.updateStatus();
      await vi.waitFor(() => expect(source.getVisibleGridLines().join('\n')).toContain('PANEL_READY'), { timeout: 5000 });
      const sourceSession = app.agentManager.getAgentSessionId(0);
      const sourceSize = { width: source.box.width, height: source.box.height };

      input.write('\x1bOS'); // F4
      await vi.waitFor(() => expect(app.layout.isFullscreen).toBe(true));
      expect(app.layout.visiblePanelIds).toEqual([0]);
      expect(source.box.width).toBe(120);
      expect(app.functionBar.getContent()).toContain('Back');
      input.write('\x1bOS');
      await vi.waitFor(() => expect(app.layout.isFullscreen).toBe(false));
      expect({ width: source.box.width, height: source.box.height }).toEqual(sourceSize);
      expect(source.inputGeneration).toBe(0n);

      input.write('\x1b[17~'); // F6
      await vi.waitFor(() => expect(app.agentManager.getRunningAgents()).toHaveLength(2), { timeout: 5000 });
      const clone = app.layout.activeTerminalPanel as TerminalPanel;
      expect(clone).not.toBe(source);
      expect(clone.panelIndex).toBe(2);
      expect(clone.workingDir).toBe(root);
      expect(app.agentManager.getAgentProfileId(2)).toBe('synthetic-panel-test');
      expect(app.agentManager.getAgentSessionId(2)).not.toBe(sourceSession);
      expect(app.agentManager.getAgentSessionId(0)).toBe(sourceSession);
      expect(app.orchestrator.protocolCapabilities.size).toBe(0);
      await vi.waitFor(() => expect(clone.getVisibleGridLines().join('\n')).toContain('PANEL_READY'), { timeout: 5000 });

      input.write('\x1b[18~'); // F7
      await vi.waitFor(() => expect(isDialogActive()).toBe(true));
      await vi.waitFor(() => expect(typeof (screen.focused as any).__listener).toBe('function'));
      (screen.focused as blessed.Widgets.TextboxElement).setValue('1');
      input.write('\r'); // accept destination through the real Blessed CR parser
      await vi.waitFor(() => expect(app.layout.workspacePanelIds).toEqual([2, 0, 1]));
      expect(app.layout.getWorkspacePosition(2)).toBe(1);
      expect(clone.panelIndex).toBe(2);
      expect(source.panelIndex).toBe(0);
      expect(app.statusBar.getContent()).toContain('P3 | Position #1');
      expect(clone.inputGeneration).toBe(0n); // dialog submission must not reach the agent

      input.write('\x1b[20~'); // F9
      await vi.waitFor(() => expect(isDialogActive()).toBe(true));
      input.write('n');
      await vi.waitFor(() => expect(isDialogActive()).toBe(false));
      expect(app.layout.panelCount).toBe(3);
      expect(clone.isRunning).toBe(true);
      expect(clone.inputGeneration).toBe(0n);

      input.write('\x1b[20~');
      await vi.waitFor(() => expect(isDialogActive()).toBe(true));
      input.write('y');
      await vi.waitFor(() => expect(app.layout.panelCount).toBe(2), { timeout: 5000 });
      expect(app.agentManager.getAgentSessionId(0)).toBe(sourceSession);
      expect(source.isRunning).toBe(true);
      expect(app.agentManager.getAgentSessionId(2)).toBeNull();
      app.layout.setActivePanel(1);
      await app.layout.activeFilePanel.loadDirectory();
      app.layout.activeFilePanel.focusEntry(keptFile);
      app.updateStatus();
      expect(app.layout.activeFilePanel.currentEntry.fullPath).toBe(keptFile);
      input.write('\x1b[20~'); // F9 on an actual selected file closes its panel only
      await vi.waitFor(() => expect(app.layout.panelCount).toBe(1));
      expect(isDialogActive()).toBe(false);
      expect(await fs.readFile(keptFile, 'utf8')).toBe('F9 closes panels, not files.');
      expect(source.isRunning).toBe(true);
    } finally {
      await app.dispose();
      screenFactory.mockRestore();
      input.destroy(); output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15000);
});
