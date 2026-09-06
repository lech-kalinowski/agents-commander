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
    agentProfiles: ['original', 'replacement'].map((name) => ({
      id: `synthetic-${name}`, adapter: 'generic', label: `Synthetic ${name}`,
      command: process.execPath,
      args: ['-e', "console.log('ORCHESTRATION_READY'); process.stdin.resume(); setInterval(() => {}, 1000);"],
      env: {},
    })),
  }) };
});

import { App } from '../../src/app.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';

describe('real Blessed orchestration replacement confirmation', () => {
  it.skipIf(process.platform === 'win32')('navigates Yes/No after task input and restores the original terminal without leaking keys', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-orchestration-confirmation-'));
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 120, rows: 32 });
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const screenFactory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
    const app: any = new App(root, { skipWelcome: true, density: 2 });

    async function submitTask(profileIndex: number, task: string): Promise<void> {
      input.write('\x0f'); // Ctrl+O through the actual terminal key parser.
      await vi.waitFor(() => expect(screen.focused.type).toBe('list'));
      for (let index = 0; index < profileIndex; index++) input.write('\x1b[B');
      input.write('\r'); // Select profile.
      input.write('\r'); // Keep the active panel as target.
      await vi.waitFor(() => {
        expect(screen.focused.type).toBe('textbox');
        expect(typeof (screen.focused as any).__listener).toBe('function');
      });
      input.write(task);
      input.write('\r');
    }

    try {
      await app.run();
      const source = app.layout.convertToTerminal(0) as TerminalPanel;
      expect(app.agentManager.launchProfile('synthetic-original', source)).toBe(true);
      app.orchestrator.connectPanel(source);
      app.layout.setActivePanel(0);
      app.updateStatus();
      await vi.waitFor(() => expect(source.getVisibleGridLines().join('\n')).toContain('ORCHESTRATION_READY'), { timeout: 5000 });
      expect(source.inputGeneration).toBe(0n);
      const terminalFocus = screen.focused;
      const originalSession = app.agentManager.getAgentSessionId(0);
      // Replacement itself is covered by orchestration lifecycle tests. Keep the
      // original synthetic PTY alive here to detect leaked modal input reliably.
      const sendTask = vi.spyOn(app.orchestrator, 'sendTask').mockResolvedValue({ success: true });

      await submitTask(0, 'reuse the original profile');
      await vi.waitFor(() => expect(sendTask).toHaveBeenCalledTimes(1));
      expect(sendTask.mock.calls[0].slice(0, 4)).toEqual([
        'generic', 0, 'reuse the original profile', 'synthetic-original',
      ]);
      expect(isDialogActive()).toBe(false);
      expect(screen.focused).toBe(terminalFocus);
      expect(screen.grabKeys).toBe(false);
      expect(source.inputGeneration).toBe(0n);
      sendTask.mockClear();

      const decisions = [
        { label: 'default No', keys: '', approved: false },
        { label: 'Left', keys: '\x1b[D', approved: true },
        { label: 'Right', keys: '\x1b[C', approved: false },
        { label: 'Tab', keys: '\t', approved: true },
        { label: 'Left then Right', keys: '\x1b[D\x1b[C', approved: false },
        { label: 'Up', keys: '\x1b[A', approved: true },
        { label: 'Up then Down', keys: '\x1b[A\x1b[B', approved: false },
        { label: 'Shift+Tab', keys: '\x1b[Z', approved: true },
      ];

      for (const decision of decisions) {
        const task = `replacement selected using ${decision.label}`;
        await submitTask(1, task);
        await vi.waitFor(() => expect((screen.focused as any)._label?.getContent()).toContain('Replace Session'));
        expect(isDialogActive()).toBe(true);
        expect(screen.grabKeys).toBe(false);
        expect(sendTask).not.toHaveBeenCalled();
        expect(source.inputGeneration).toBe(0n);

        input.write(decision.keys + '\r');
        await vi.waitFor(() => expect(isDialogActive()).toBe(false));
        expect(sendTask, decision.label).toHaveBeenCalledTimes(decision.approved ? 1 : 0);
        if (decision.approved) {
          expect(sendTask.mock.calls[0].slice(0, 4)).toEqual([
            'generic', 0, task, 'synthetic-replacement',
          ]);
        }
        expect(screen.focused, decision.label).toBe(terminalFocus);
        expect(screen.grabKeys, decision.label).toBe(false);
        expect(source.inputGeneration, decision.label).toBe(0n);
        expect(source.isRunning).toBe(true);
        expect(app.agentManager.getAgentSessionId(0)).toBe(originalSession);
        sendTask.mockClear();
      }
    } finally {
      await app.dispose();
      screenFactory.mockRestore();
      input.destroy();
      output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15000);

  it.skipIf(process.platform === 'win32')('launches a second profile in an empty panel and cancels replacement of an occupied panel', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-agent-launch-confirmation-'));
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 120, rows: 32 });
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const screenFactory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
    const app: any = new App(root, { skipWelcome: true, density: 2 });

    try {
      await app.run();
      const first = app.layout.convertToTerminal(0) as TerminalPanel;
      expect(app.agentManager.launchProfile('synthetic-original', first)).toBe(true);
      app.orchestrator.connectPanel(first);
      app.layout.setActivePanel(0);
      app.updateStatus();
      await vi.waitFor(() => expect(first.getVisibleGridLines().join('\n')).toContain('ORCHESTRATION_READY'), { timeout: 5000 });
      expect(first.inputGeneration).toBe(0n);
      const firstSession = app.agentManager.getAgentSessionId(0);

      input.write('\x1bOQ'); // F2 from occupied P1.
      await vi.waitFor(() => expect(screen.focused.type).toBe('list'));
      input.write('\x1b[B'); // Second named profile.
      input.write('\x1b[C'); // Explicitly select empty P2 as launch target.
      input.write('\r');
      await vi.waitFor(() => expect(app.agentManager.getRunningAgents()).toHaveLength(2), { timeout: 5000 });
      const second = app.layout.getTerminalPanel(1) as TerminalPanel;
      await vi.waitFor(() => expect(second.getVisibleGridLines().join('\n')).toContain('ORCHESTRATION_READY'), { timeout: 5000 });
      expect(app.agentManager.getAgentProfileId(1)).toBe('synthetic-replacement');
      expect(app.layout.activePanel.panelIndex).toBe(1);
      expect(isDialogActive()).toBe(false);
      expect(first.inputGeneration).toBe(0n);
      expect(second.inputGeneration).toBe(0n);
      const secondFocus = screen.focused;
      const secondSession = app.agentManager.getAgentSessionId(1);

      for (const cancelWithMouse of [false, true]) {
        input.write('\x1bOQ'); // F2 from P2.
        await vi.waitFor(() => expect(screen.focused.type).toBe('list'));
        input.write('\x1b[B');
        input.write('\x1b[D'); // Target occupied P1.
        input.write('\r');
        await vi.waitFor(() => expect((screen.focused as any)._label?.getContent()).toContain('Replace Session'));
        expect(screen.grabKeys).toBe(false);
        if (cancelWithMouse) {
          const noButton = screen.focused.children.find((child: any) => child.getText?.().includes('[  No  ]')) as blessed.Widgets.BoxElement;
          expect(noButton).toBeDefined();
          const coordinates = (noButton as any).lpos;
          const x = coordinates.xi + 2;
          const y = coordinates.yi + 1;
          input.write(`\x1b[<0;${x};${y}M`);
          input.write(`\x1b[<0;${x};${y}m`);
        } else {
          input.write('\x1b'); // Escape must dismiss without stopping either PTY.
        }
        await vi.waitFor(() => expect(isDialogActive()).toBe(false));
        expect(screen.focused).toBe(secondFocus);
        expect(screen.grabKeys).toBe(false);
        expect(first.isRunning).toBe(true);
        expect(second.isRunning).toBe(true);
        expect(first.inputGeneration).toBe(0n);
        expect(second.inputGeneration).toBe(0n);
        expect(app.agentManager.getAgentSessionId(0)).toBe(firstSession);
        expect(app.agentManager.getAgentSessionId(1)).toBe(secondSession);
      }
    } finally {
      await app.dispose();
      screenFactory.mockRestore();
      input.destroy();
      output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15000);

  it.skipIf(process.platform === 'win32')('keeps a replacement popup focused when an earlier task finishes delivery', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-delivery-modal-focus-'));
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 120, rows: 32 });
    output.resume();
    const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
    const screenFactory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
    const app: any = new App(root, { skipWelcome: true, density: 2 });
    let finishSubmission = () => {};
    const submissionGate = new Promise<void>((resolve) => { finishSubmission = resolve; });

    try {
      await app.run();
      const source = app.layout.convertToTerminal(0) as TerminalPanel;
      expect(app.agentManager.launchProfile('synthetic-original', source)).toBe(true);
      app.orchestrator.connectPanel(source);
      app.layout.setActivePanel(0);
      app.updateStatus();
      await vi.waitFor(() => expect(source.getVisibleGridLines().join('\n')).toContain('ORCHESTRATION_READY'), { timeout: 5000 });
      const originalSession = app.agentManager.getAgentSessionId(0);
      const originalFocus = screen.focused;
      // Keep the real sendTask/input-lane workflow. Only hold its final submit
      // so the user can open another dialog during asynchronous task delivery.
      const sendTask = vi.spyOn(app.orchestrator, 'sendTask');
      const submitInput = vi.spyOn(app.orchestrator, 'submitInput').mockImplementation(async () => {
        await submissionGate;
        return true;
      });

      input.write('\x0f');
      await vi.waitFor(() => expect(screen.focused.type).toBe('list'));
      input.write('\r'); // Same running profile.
      input.write('\r'); // Target P1.
      await vi.waitFor(() => expect(typeof (screen.focused as any).__listener).toBe('function'));
      input.write('First task has a delayed submission');
      input.write('\r');
      await vi.waitFor(() => expect(submitInput).toHaveBeenCalledOnce());
      expect(isDialogActive()).toBe(false);

      input.write('\x1bOQ'); // Start another launch while the first task is pending.
      await vi.waitFor(() => expect(screen.focused.type).toBe('list'));
      input.write('\x1b[B'); // Different profile in occupied P1 requires consent.
      input.write('\r');
      await vi.waitFor(() => expect((screen.focused as any)._label?.getContent()).toContain('Replace Session'));
      const confirmationFocus = screen.focused;
      const inputsBeforeCompletion = source.inputGeneration;
      expect(isDialogActive()).toBe(true);

      finishSubmission();
      await expect(sendTask.mock.results[0].value).resolves.toEqual({ success: true });
      expect(isDialogActive()).toBe(true);
      expect(screen.focused === confirmationFocus, 'earlier task completion must not steal modal focus').toBe(true);
      input.write('\x1b');
      await vi.waitFor(() => expect(isDialogActive()).toBe(false));
      expect(screen.focused).toBe(originalFocus);
      expect(screen.grabKeys).toBe(false);
      expect(source.inputGeneration).toBe(inputsBeforeCompletion);
      expect(source.isRunning).toBe(true);
      expect(app.agentManager.getAgentSessionId(0)).toBe(originalSession);

      // Completing a later delivery without a modal still activates its target.
      app.layout.setActivePanel(1);
      expect(app.layout.activePanel.panelIndex).toBe(1);
      await expect(app.orchestrator.sendTask('generic', 0, 'A later task without a popup', 'synthetic-original'))
        .resolves.toEqual({ success: true });
      expect(app.layout.activePanel.panelIndex).toBe(0);
      expect(screen.focused === originalFocus).toBe(true);
    } finally {
      finishSubmission();
      await app.dispose();
      screenFactory.mockRestore();
      input.destroy();
      output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15000);
});
