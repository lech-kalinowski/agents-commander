import blessed from 'blessed';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { isDialogActive } from '../../src/utils/dialog-state.js';

const fixture = vi.hoisted(() => ({ cwd: '' }));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), close: vi.fn() },
}));
vi.mock('../../src/file-manager/file-watcher.js', () => ({
  startWatching: vi.fn(), stopWatching: vi.fn(),
}));
vi.mock('../../src/config/loader.js', async () => {
  const { defaultConfig } = await import('../../src/config/defaults.js');
  return { loadConfig: () => ({
    ...structuredClone(defaultConfig),
    agentProfiles: [{
      id: 'synthetic-bulk-profile', adapter: 'generic', label: 'Synthetic bulk profile',
      command: process.execPath,
      args: ['-e', [
        'process.stdin.setRawMode(true); process.stdin.setEncoding("utf8");',
        'let pending = ""; let submitted = 0;',
        'process.stdin.on("data", chunk => { pending += chunk; let end;',
        'while ((end = pending.indexOf("\\r")) >= 0) {',
        'const frame = pending.slice(0, end); pending = pending.slice(end + 1);',
        'const match = /^\\x1b\\[200~([\\s\\S]+)\\x1b\\[201~$/.exec(frame);',
        'const key = match && /Protocol capability: ([A-Za-z0-9_-]{43})\\./.exec(match[1]);',
        'console.log(key ? "BULK_PROTOCOL_OK:" + key[1] + ":" + (++submitted) : "BULK_INPUT_BAD");',
        '}});',
        "console.log(process.argv[1] === 'bulk-argument' ? 'ARG_OK' : 'ARG_BAD');",
        "console.log(process.env.BULK_FIXTURE_VALUE === 'bulk-environment' ? 'ENV_OK' : 'ENV_BAD');",
        "console.log(process.cwd() === process.env.BULK_FIXTURE_CWD ? 'CWD_OK' : 'CWD_BAD');",
        "console.log('BULK_READY');",
        'process.stdin.resume(); setInterval(() => {}, 1000);',
      ].join(''), 'bulk-argument'],
      env: { BULK_FIXTURE_VALUE: 'bulk-environment', BULK_FIXTURE_CWD: fixture.cwd },
    }],
  }) };
});

import { App } from '../../src/app.js';
import { FilePanel } from '../../src/panels/file-panel.js';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';

async function createHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-bulk-launch-'));
  const selectedPath = path.join(root, 'selected-project');
  await fs.mkdir(selectedPath);
  // macOS os.tmpdir() may use /var while child process.cwd() resolves /private/var.
  const cwd = await fs.realpath(selectedPath);
  fixture.cwd = cwd;
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 160, rows: 44 });
  output.resume();
  const screen = blessed.screen({ input, output, terminal: 'xterm-256color', smartCSR: false });
  const screenFactory = vi.spyOn(blessed, 'screen').mockReturnValue(screen);
  const app: any = new App(root, { skipWelcome: true, density: 2 });
  const dispose = async () => {
    try {
      await app.dispose();
      await TerminalPanel.waitForPendingTerminations();
    } finally {
      screenFactory.mockRestore();
      input.destroy();
      output.destroy();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
  try {
    await app.run();
    await app.layout.activeFilePanel.loadDirectory(cwd);
    return { app, screen, input, root, cwd, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

async function chooseBatch(
  harness: Awaited<ReturnType<typeof createHarness>>,
  count: number,
): Promise<void> {
  harness.input.write('\x1bOQ'); // F2 through the real Blessed key parser.
  await vi.waitFor(() => {
    expect(isDialogActive()).toBe(true);
    expect(harness.screen.focused?.type).toBe('list');
  });
  const picker = harness.screen.focused;
  harness.input.write(`n${count}\r`);
  await vi.waitFor(() => {
    expect(isDialogActive()).toBe(true);
    expect(harness.screen.focused).not.toBe(picker);
    expect(harness.screen.focused?.type).toBe('box');
  });
}

/** Select every running session except the original P1 through actual keys. */
async function chooseProtocolBatch(harness: Awaited<ReturnType<typeof createHarness>>): Promise<void> {
  harness.input.write('\x1bOQ');
  await vi.waitFor(() => {
    expect(isDialogActive()).toBe(true);
    expect(harness.screen.focused?.type).toBe('list');
  });
  const agentPicker = harness.screen.focused;
  harness.input.write('p');
  await vi.waitFor(() => {
    expect(harness.screen.focused).not.toBe(agentPicker);
    expect(harness.screen.focused?.type).toBe('box');
    expect(harness.screen.focused?.children.some(child => child.type === 'list')).toBe(true);
  });
  const protocolPicker = harness.screen.focused!;
  const sessions = protocolPicker.children.find(child => child.type === 'list') as blessed.Widgets.ListElement;
  expect(sessions.getItem(0).getContent()).toMatch(/^\[ \] P1 /u);
  harness.input.write('a '); // Select all 17, then toggle the current first row (P1) off.
  await vi.waitFor(() => {
    expect(sessions.getItem(0).getContent()).toMatch(/^\[ \] P1 /u);
    for (let index = 1; index <= 16; index++) {
      expect(sessions.getItem(index).getContent()).toMatch(/^\[x\] P\d+ /u);
    }
  });
  harness.input.write('\r');
  await vi.waitFor(() => {
    expect(isDialogActive()).toBe(true);
    expect(harness.screen.focused).not.toBe(protocolPicker);
    expect(harness.screen.focused?.children.map(child => child.getContent()).join('\n'))
      .toContain('Inject into 16 selected agents');
  });
}

describe('real Blessed bulk launch with synthetic local PTYs', () => {
  it.skipIf(process.platform === 'win32')(
    'launches sixteen profiles without protocol, then explicitly injects unique keys into only those selected sessions',
    async () => {
      const harness = await createHarness();
      const { app, input, cwd } = harness;
      const ownedPanels: TerminalPanel[] = [];
      let ownedProcesses: ChildProcess[] = [];
      const restoreInputSpies: Array<() => void> = [];
      try {
        const source = app.layout.convertToTerminal(0) as TerminalPanel;
        ownedPanels.push(source);
        expect(app.agentManager.launchProfile('synthetic-bulk-profile', source)).toBe(true);
        app.orchestrator.connectPanel(source);
        app.layout.setActivePanel(0);
        app.updateStatus();
        await vi.waitFor(() => {
          expect(source.getVisibleGridLines().join('\n')).toContain('BULK_READY');
        }, { timeout: 5000 });
        const sourceSession = app.agentManager.getAgentSessionId(0);
        const sourceGeneration = source.sessionGeneration;
        const unchangedFilePanel = app.layout.getPanel(1);

        await chooseBatch(harness, 16);
        // A real CR emits both enter and return. Neither may double-submit a batch.
        expect(app.layout.panelCount).toBe(2);
        expect(app.agentManager.getRunningAgents()).toHaveLength(1);
        input.write('y');
        await vi.waitFor(() => {
          expect(isDialogActive()).toBe(false);
          expect(app.layout.panelCount).toBe(18);
          expect(app.agentManager.getRunningAgents()).toHaveLength(17);
        }, { timeout: 10000 });

        const newIds = app.layout.workspacePanelIds.filter((id: number) => id > 1) as number[];
        expect(newIds).toEqual(Array.from({ length: 16 }, (_, index) => index + 2));
        const terminals = newIds.map((id) => app.layout.getTerminalPanel(id) as TerminalPanel);
        ownedPanels.push(...terminals);
        ownedProcesses = ownedPanels.map((terminal) => (
          (terminal as unknown as { proc: ChildProcess }).proc
        ));
        expect(ownedProcesses.every((child) => typeof child.pid === 'number')).toBe(true);
        expect(new Set(ownedProcesses.map((child) => child.pid)).size).toBe(17);
        await vi.waitFor(() => {
          for (const terminal of terminals) {
            const grid = terminal.getVisibleGridLines().join('\n');
            for (const marker of ['ARG_OK', 'ENV_OK', 'CWD_OK', 'BULK_READY']) {
              expect(grid).toContain(marker);
            }
          }
        }, { timeout: 10000 });

        expect(app.layout.getPanel(0)).toBe(source);
        expect(app.layout.getPanel(1)).toBe(unchangedFilePanel);
        expect(app.agentManager.getAgentSessionId(0)).toBe(sourceSession);
        expect(source.sessionGeneration).toBe(sourceGeneration);
        expect(source.isRunning).toBe(true);
        expect(source.inputGeneration).toBe(0n);
        const sessionIds = terminals.map((terminal) => (
          app.agentManager.getAgentSessionId(terminal.panelIndex)
        ));
        expect(sessionIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
        expect(new Set([sourceSession, ...sessionIds]).size).toBe(17);
        for (const terminal of terminals) {
          expect(terminal.workingDir).toBe(cwd);
          expect(terminal.cols).toBeGreaterThan(10);
          expect(Number(terminal.box.height)).toBeGreaterThan(5);
          expect(terminal.inputGeneration).toBe(0n);
          expect(app.agentManager.getAgentProfileId(terminal.panelIndex)).toBe('synthetic-bulk-profile');
        }
        expect(terminals.filter((terminal) => !terminal.isVisible).length).toBeGreaterThan(0);
        expect(app.layout.mode).toBe(2);
        expect(app.orchestrator.connectedPanels.size).toBe(17);
        expect(app.orchestrator.protocolCapabilities.size).toBe(0);
        expect(app.orchestrator.protocolInjected.size).toBe(0);

        const inputSpies = new Map(ownedPanels.map(terminal => {
          const spy = vi.spyOn(terminal, 'sendInput'); // Observe actual writes, without replacing the real PTY path.
          restoreInputSpies.push(() => spy.mockRestore());
          return [terminal.panelIndex, spy];
        }));
        const launch = vi.spyOn(app.agentManager, 'launchProfile');
        const task = vi.spyOn(app.orchestrator, 'sendTask');
        restoreInputSpies.push(() => launch.mockRestore(), () => task.mockRestore());
        const activePanelBeforeProtocol = app.layout.activePanelId;
        const initialSessionIds = ownedPanels.map(terminal => app.agentManager.getAgentSessionId(terminal.panelIndex));

        await chooseProtocolBatch(harness);
        input.write('\r'); // Untouched default No: selection and Enter must not arm any session.
        await vi.waitFor(() => expect(isDialogActive()).toBe(false));
        expect(app.orchestrator.protocolCapabilities.size).toBe(0);
        for (const spy of inputSpies.values()) expect(spy).not.toHaveBeenCalled();

        await chooseProtocolBatch(harness);
        input.write('y');
        await vi.waitFor(() => {
          expect(isDialogActive()).toBe(false);
          expect(app.orchestrator.protocolCapabilities.size).toBe(16);
          expect(app.orchestrator.protocolInjected.size).toBe(16);
        }, { timeout: 15000 });
        const keys = sessionIds.map(sessionId => app.orchestrator.protocolCapabilities.get(sessionId) as string);
        expect(new Set(keys).size).toBe(16);
        expect(app.orchestrator.protocolCapabilities.has(sourceSession)).toBe(false);
        expect(inputSpies.get(0)).not.toHaveBeenCalled();
        expect(source.inputGeneration).toBe(0n);
        for (const [index, terminal] of terminals.entries()) {
          const key = keys[index];
          expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
          const writes = inputSpies.get(terminal.panelIndex)!.mock.calls.map(([value]) => value);
          expect(writes[0]).toBe('\x1b[200~');
          expect(writes.at(-2)).toBe('\x1b[201~');
          expect(writes.at(-1)).toBe('\r');
          expect(writes.filter(value => value === '\r')).toHaveLength(1);
          expect(writes.filter(value => value === '\x1b[200~')).toHaveLength(1);
          expect(writes.filter(value => value === '\x1b[201~')).toHaveLength(1);
          expect(writes.slice(1, -2).join('')).toContain(`Protocol capability: ${key}.`);
          for (const modalKey of ['p', 'a', ' ', 'y']) expect(writes).not.toContain(modalKey);
        }
        await vi.waitFor(() => {
          for (const [index, terminal] of terminals.entries()) {
            const grid = terminal.getVisibleGridLines().join('\n');
            // The child acknowledges only a complete bracketed prompt followed by one real submit.
            expect(grid).toContain(`BULK_PROTOCOL_OK:${keys[index]}:1`);
            expect(grid).not.toContain('BULK_INPUT_BAD');
          }
        }, { timeout: 5000 });
        expect(app.layout.panelCount).toBe(18);
        expect(app.layout.getPanel(0)).toBe(source);
        expect(app.layout.getPanel(1)).toBe(unchangedFilePanel);
        expect(app.layout.activePanelId).toBe(activePanelBeforeProtocol);
        expect(source.sessionGeneration).toBe(sourceGeneration);
        expect(ownedPanels.map(terminal => app.agentManager.getAgentSessionId(terminal.panelIndex)))
          .toEqual(initialSessionIds);
        expect(app.agentManager.getRunningAgents()).toHaveLength(17);
        expect(launch).not.toHaveBeenCalled();
        expect(task).not.toHaveBeenCalled();
        expect(app.orchestrator.getRecentActivity()).toEqual([]);
        expect(app.capture.mode).toBe('off');
      } finally {
        for (const restore of restoreInputSpies) restore();
        await harness.dispose();
      }
      expect(ownedPanels.every((terminal) => !terminal.isRunning)).toBe(true);
      expect(ownedProcesses.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
      expect(app.agentManager.getRunningAgents()).toHaveLength(0);
      expect(isDialogActive()).toBe(false);
    },
    45000,
  );

  it.skipIf(process.platform === 'win32')(
    'accepts Escape during an in-flight allocation without stopping completed launches or forwarding keys',
    async () => {
      const harness = await createHarness();
      const { app, input } = harness;
      const originalAdd = app.layout.addPanel.bind(app.layout);
      let releaseAllocation: (() => void) | undefined;
      let allocationEntered = false;
      let allocationCalls = 0;
      const ownedProcesses: ChildProcess[] = [];
      const addPanel = vi.spyOn(app.layout, 'addPanel').mockImplementation(async (...args: unknown[]) => {
        const result = await originalAdd(...args);
        allocationCalls += 1;
        if (allocationCalls === 2) {
          allocationEntered = true;
          await new Promise<void>((resolve) => { releaseAllocation = resolve; });
        }
        return result;
      });
      try {
        const originalPanels = [...app.layout.allPanels];
        await chooseBatch(harness, 10);
        input.write('y');
        await vi.waitFor(() => expect(allocationEntered).toBe(true), { timeout: 5000 });
        expect(isDialogActive()).toBe(true);
        expect(app.agentManager.getRunningAgents()).toHaveLength(1);
        const terminal = app.layout.getTerminalPanel(2) as TerminalPanel;
        ownedProcesses.push((terminal as unknown as { proc: ChildProcess }).proc);
        await vi.waitFor(() => {
          expect(terminal.getVisibleGridLines().join('\n')).toContain('BULK_READY');
        }, { timeout: 5000 });

        input.write('\x1b'); // Cancel through real terminal input, while addPanel is awaiting.
        await vi.waitFor(() => {
          expect(harness.screen.focused?.getContent()).toContain('Stopping remaining');
        });
        expect(isDialogActive()).toBe(true); // Shield persists until in-flight allocation settles.
        input.write('x\r'); // Must not reach the launched process behind that shield.
        releaseAllocation?.();
        await vi.waitFor(() => expect(isDialogActive()).toBe(false));

        expect(allocationCalls).toBe(2);
        expect(app.agentManager.getRunningAgents()).toHaveLength(1);
        expect(app.layout.getPanel(0)).toBe(originalPanels[0]);
        expect(app.layout.getPanel(1)).toBe(originalPanels[1]);
        expect(app.layout.getTerminalPanel(3)).toBeNull(); // Allocated, but not launched after Esc.
        expect(terminal.isRunning).toBe(true);
        expect(terminal.inputGeneration).toBe(0n);
        expect(app.orchestrator.protocolCapabilities.size).toBe(0);
      } finally {
        releaseAllocation?.();
        addPanel.mockRestore();
        await harness.dispose();
      }
      expect(ownedProcesses.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
      expect(isDialogActive()).toBe(false);
    },
    15000,
  );

  it.skipIf(process.platform === 'win32')(
    'keeps a newly visible panel below the progress mouse shield while its directory load is pending',
    async () => {
      const harness = await createHarness();
      const { app, input, screen } = harness;
      await app.layout.setMode(4);
      const originalLoad = FilePanel.prototype.loadDirectory;
      let releaseDirectory: (() => void) | undefined;
      let loadingPanel: FilePanel | undefined;
      const loadDirectory = vi.spyOn(FilePanel.prototype, 'loadDirectory').mockImplementation(
        async function (this: FilePanel, directory?: string) {
          if (this.panelIndex === 2) {
            loadingPanel = this;
            await new Promise<void>((resolve) => { releaseDirectory = resolve; });
          }
          return originalLoad.call(this, directory);
        },
      );
      try {
        const originalPanels = [...app.layout.allPanels];
        await chooseBatch(harness, 4);
        input.write('y');
        await vi.waitFor(() => expect(loadingPanel).toBeDefined());
        const panel = loadingPanel!;
        expect(panel.isVisible).toBe(true);
        expect(app.layout.visiblePanelIds).toContain(2);
        expect(app.layout.panelCount).toBe(3);
        expect(app.agentManager.getRunningAgents()).toHaveLength(0);
        expect(isDialogActive()).toBe(true);
        const progress = screen.focused as blessed.Widgets.BoxElement;
        expect(progress.getContent()).toContain('Started 0 of 4');
        const shield = screen.children.find((child) => (
          (child as unknown as { options: { transparent?: boolean } }).options.transparent === true
        )) as blessed.Widgets.BoxElement;
        expect(shield).toBeDefined();
        screen.render();

        const panelOrder = screen.children.indexOf(panel.box);
        const shieldOrder = screen.children.indexOf(shield);
        const progressOrder = screen.children.indexOf(progress);
        expect(panelOrder).toBeGreaterThanOrEqual(0);
        expect(panelOrder).toBeLessThan(shieldOrder);
        expect(shieldOrder).toBeLessThan(progressOrder);
        expect((screen as unknown as { clickable: unknown[] }).clickable.includes(shield)).toBe(true);
        const renderedIndex = (element: blessed.Widgets.Node): number => (
          (element as unknown as { index: number }).index
        );
        const inspectDescendants = (element: blessed.Widgets.Node): void => {
          expect(renderedIndex(element)).toBeLessThan(renderedIndex(shield));
          for (const child of element.children) inspectDescendants(child);
        };
        inspectDescendants(panel.box);
        expect(screen.focused).toBe(progress);

        const list = panel.box.children.find((child) => child.type === 'list') as blessed.Widgets.ListElement;
        expect(list).toBeDefined();
        const click = vi.fn();
        const parsedMouse = vi.fn();
        list.on('click', click);
        panel.box.on('click', click);
        screen.program.on('mouse', parsedMouse);
        const selected = (list as unknown as { selected: number }).selected;
        const x = Number(list.aleft) + 3;
        const y = Number(list.atop) + 2;
        input.write(`\x1b[<0;${x};${y}M`);
        expect((screen as unknown as { mouseDown: unknown }).mouseDown === shield).toBe(true);
        input.write(`\x1b[<0;${x};${y}m`);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(parsedMouse).toHaveBeenCalledTimes(2);
        expect((screen as unknown as { mouseDown: unknown }).mouseDown).toBeNull();
        expect(click).not.toHaveBeenCalled();
        expect((list as unknown as { selected: number }).selected).toBe(selected);
        expect(screen.focused).toBe(progress);
        expect(app.layout.activePanel).toBe(originalPanels[0]);

        input.write('\x1b');
        await vi.waitFor(() => expect(progress.getContent()).toContain('Stopping remaining'));
        expect(isDialogActive()).toBe(true);
        releaseDirectory?.();
        await vi.waitFor(() => expect(isDialogActive()).toBe(false));
        expect(app.agentManager.getRunningAgents()).toHaveLength(0);
        expect(app.layout.getTerminalPanel(2)).toBeNull();
        expect(app.layout.getPanel(0)).toBe(originalPanels[0]);
        expect(app.layout.getPanel(1)).toBe(originalPanels[1]);
        expect(app.layout.panelCount).toBe(3);
      } finally {
        releaseDirectory?.();
        loadDirectory.mockRestore();
        await harness.dispose();
      }
      expect(isDialogActive()).toBe(false);
    },
    10000,
  );

  it.skipIf(process.platform === 'win32')(
    'keeps the default No confirmation non-destructive',
    async () => {
      const harness = await createHarness();
      const { app, input } = harness;
      try {
        const originalPanels = [...app.layout.allPanels];
        await chooseBatch(harness, 10);
        input.write('\r'); // No is the untouched default; both CR events stay in the modal.
        await vi.waitFor(() => expect(isDialogActive()).toBe(false));
        expect(app.layout.allPanels).toEqual(originalPanels);
        expect(app.layout.panelCount).toBe(2);
        expect(app.agentManager.getRunningAgents()).toHaveLength(0);
        expect(app.orchestrator.connectedPanels.size).toBe(0);
      } finally {
        await harness.dispose();
      }
    },
    10000,
  );
});
