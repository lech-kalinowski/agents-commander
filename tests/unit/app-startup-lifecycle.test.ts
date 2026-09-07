import blessed from 'blessed';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ initialize: vi.fn(async () => undefined) }));
vi.mock('../../src/config/loader.js', async () => {
  const { defaultConfig } = await import('../../src/config/defaults.js');
  return { loadConfig: () => structuredClone(defaultConfig) };
});
vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() },
}));
vi.mock('../../src/file-manager/file-watcher.js', () => ({ startWatching: vi.fn(), stopWatching: vi.fn() }));
vi.mock('../../src/screen/layout-manager.js', () => ({
  LayoutManager: class {
    initialize = harness.initialize;
    terminalPanels = [];
  },
}));
vi.mock('../../src/orchestration/orchestrator.js', () => ({
  Orchestrator: vi.fn(class { sealAndDrain = vi.fn(async () => true); }),
}));

import { App } from '../../src/app.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import { startWatching } from '../../src/file-manager/file-watcher.js';
import { appEvents } from '../../src/utils/events.js';

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('App startup cancellation', () => {
  function fixture() {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 120, rows: 36 });
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color' });
    const screenFactory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
    const app: any = new App('/synthetic-startup', { skipWelcome: true });
    app.updateStatus = vi.fn();
    app.setupGlobalKeys = vi.fn();
    app.startCodexMicroNativeInput = vi.fn();
    const cleanup = async () => {
      await app.dispose();
      // Also clean any resources created after disposal if a regression fails.
      if (app.fileChangedHandler) appEvents.removeListener('file:changed', app.fileChangedHandler);
      screen.destroy();
      input.destroy();
      output.destroy();
    };
    return { app, screenFactory, cleanup };
  }

  it('does not start resource owners after disposal interrupts initial directory loading', async () => {
    let release!: () => void;
    harness.initialize.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const { app, cleanup } = fixture();
    const listenersBefore = appEvents.listenerCount('file:changed');
    const running = app.run();
    try {
      expect(harness.initialize).toHaveBeenCalledOnce();
      await app.dispose();
      release();
      await running;
      expect(Orchestrator).not.toHaveBeenCalled();
      expect(startWatching).not.toHaveBeenCalled();
      expect(app.setupGlobalKeys).not.toHaveBeenCalled();
      expect(app.startCodexMicroNativeInput).not.toHaveBeenCalled();
      expect(appEvents.listenerCount('file:changed')).toBe(listenersBefore);
    } finally {
      release();
      await running.catch(() => undefined);
      await cleanup();
    }
  });

  it('rejects running an already-disposed application without creating a screen', async () => {
    const { app, screenFactory, cleanup } = fixture();
    try {
      await app.dispose();
      await expect(app.run()).rejects.toThrow(/shutdown has begun/u);
      expect(screenFactory).not.toHaveBeenCalled();
      expect(startWatching).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
