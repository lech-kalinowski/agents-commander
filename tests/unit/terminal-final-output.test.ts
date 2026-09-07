import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';
import { VTerm } from '../../src/panels/vterm.js';
import { AgentManager } from '../../src/agents/agent-manager.js';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import { ProtocolScanner } from '../../src/orchestration/protocol.js';

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: childProcess.spawn,
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/utils/runtime-assets.js', () => ({
  runtimeAssetLookupForModule: vi.fn(() => ({})),
  resolvePtyHelperPath: vi.fn(() => '/synthetic/pty-helper.py'),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const capability = 'a'.repeat(43);

function createPanel(panelIndex = 0) {
  const streams = Array.from({ length: 4 }, () => new PassThrough());
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    stdin: streams[0], stdout: streams[1], stderr: streams[2], stdio: streams,
    exitCode: null as number | null, signalCode: null,
    kill: vi.fn(() => true),
  });
  childProcess.spawn.mockReturnValueOnce(child);
  const emitted = vi.fn();
  const panel: any = Object.assign(Object.create(TerminalPanel.prototype), {
    panelIndex, agentName: 'Synthetic', cwd: '/synthetic',
    launchSealed: false, _sessionGeneration: 0, _status: 'running',
    vterm: new VTerm(200, 30),
    orchConfig: {
      gridScanDelay: 200, dedupWindow: 15000,
      maxContentLines: 500, maxContentBytes: 262144,
    },
    activeGridProtocolKeys: new Set(), activeTailReplyKeys: new Set(),
    recentEmissions: new Map(), protocolReservations: new Map(),
    pendingReplyEmissions: new Map(), instructionEchoGuardUntil: 0,
    pendingTerminations: new Set(), shutdownPromise: null,
    gridScanTimer: null, commanderActivityTimer: null,
    getTerminalDimensions: () => ({ cols: 200, rows: 30 }),
    resolveFullPath: (command: string) => `/synthetic/${command}`,
    updateHeader: vi.fn(), scheduleRender: vi.fn(),
    showCommanderActivity: vi.fn(),
    onCommanderMessage: emitted,
  });
  return {
    panel, child, emitted,
    close() {
      child.exitCode = 0;
      child.emit('close', 0, null);
    },
    dispose() {
      panel.clearPendingReplyEmissions();
      if (panel.gridScanTimer) clearTimeout(panel.gridScanTimer);
      for (const stream of streams) stream.destroy();
    },
  };
}

function frame(type = 'SEND:generic:2', body = 'Final response', key = capability) {
  return Buffer.from(`===COMMANDER:${type}:${key}===\r\n${body}\r\n===COMMANDER:END:${key}===\r\n`);
}

describe('TerminalPanel final protocol output', () => {
  it.each(['SEND:generic:2', 'REPLY', 'BROADCAST'])(
    'observes one complete final %s frame before clearing its process on close',
    (type) => {
      vi.useFakeTimers();
      const fixture = createPanel();
      const { panel, child, emitted } = fixture;
      try {
        expect(panel.launchSession('synthetic', [], {}, true, 'internal')).toBe(true);
        child.stdout.emit('data', frame(type));
        expect(emitted).not.toHaveBeenCalled();
        fixture.close();
        expect(emitted).toHaveBeenCalledOnce();
        expect(emitted.mock.calls[0][0]).toMatchObject({ content: 'Final response', capability });
        expect(panel.gridScanTimer).toBeNull();
        expect(panel.pendingReplyEmissions.size).toBe(0);
      } finally {
        fixture.dispose();
      }
    },
  );

  it('does not finalize incomplete or muted frames', () => {
    vi.useFakeTimers();
    for (const muted of [false, true]) {
      const fixture = createPanel();
      try {
        fixture.panel.launchSession('synthetic', [], {}, true, 'internal');
        if (muted) fixture.panel.muteScanner(1000);
        fixture.child.stdout.emit('data', muted ? frame() : Buffer.from(
          `===COMMANDER:SEND:generic:2:${capability}===\r\nunfinished\r\n`,
        ));
        fixture.close();
        expect(fixture.emitted).not.toHaveBeenCalled();
      } finally { fixture.dispose(); }
    }
  });

  it('does not replay a previously visible frame after its deduplication timer expires', () => {
    vi.useFakeTimers();
    const fixture = createPanel();
    try {
      fixture.panel.launchSession('synthetic', [], {}, true, 'internal');
      fixture.child.stdout.emit('data', frame());
      vi.advanceTimersByTime(50);
      expect(fixture.emitted).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(16000);
      fixture.close();
      expect(fixture.emitted).toHaveBeenCalledOnce();
    } finally { fixture.dispose(); }
  });

  it('stops final scanning when a callback replaces the current process', () => {
    vi.useFakeTimers();
    const fixture = createPanel();
    try {
      fixture.panel.launchSession('synthetic', [], {}, true, 'internal');
      const emitted = vi.fn(() => { fixture.panel.proc = new EventEmitter(); });
      fixture.panel.onCommanderMessage = emitted;
      fixture.child.stdout.emit('data', Buffer.concat([
        frame('SEND:generic:2', 'first'), frame('SEND:generic:2', 'second'),
      ]));
      fixture.close();
      expect(emitted).toHaveBeenCalledOnce();
      expect(emitted.mock.calls[0][0].content).toBe('first');
      expect(fixture.panel.isRunning).toBe(true);
    } finally { fixture.dispose(); }
  });

  it.each(['bytes', 'lines'] as const)('enforces matching %s limits across streaming, grid, and tail scanners', (limit) => {
    vi.useFakeTimers();
    const fixture = createPanel();
    try {
      fixture.panel.orchConfig.maxContentBytes = 1024;
      fixture.panel.orchConfig.maxContentLines = 1;
      fixture.panel.launchSession('synthetic', [], {}, true, 'internal');
      const oversized = limit === 'bytes' ? '🙂'.repeat(260) : 'first\nsecond';
      fixture.child.stdout.emit('data', frame('REPLY', oversized));
      fixture.panel.scanRenderedTailForReplies();
      expect(fixture.emitted).not.toHaveBeenCalled();
      fixture.panel.scanGridForProtocol();
      expect(fixture.emitted).not.toHaveBeenCalled();

      const streamed = vi.fn();
      const scanner = new ProtocolScanner(0, 'Synthetic', streamed, fixture.panel.orchConfig);
      scanner.feed(frame('REPLY', oversized).toString());
      expect(streamed).not.toHaveBeenCalled();

      // Exactly 1024 bytes including LF and one logical line, even when wrapped.
      const accepted = `${'🙂'.repeat(255)}abc`;
      scanner.feed(frame('REPLY', accepted).toString());
      fixture.child.stdout.emit('data', frame('REPLY', accepted));
      fixture.panel.scanRenderedTailForReplies();
      fixture.panel.scanGridForProtocol();
      expect(streamed).toHaveBeenCalledOnce();
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0].content).toBe(accepted);
    } finally { fixture.dispose(); }
  });

  it('preserves the live reply delay but flushes a reconciled scrollback reply on close', () => {
    vi.useFakeTimers();
    const fixture = createPanel();
    try {
      fixture.panel.launchSession('synthetic', [], {}, true, 'internal');
      fixture.child.stdout.emit('data', Buffer.concat([
        frame('REPLY'), Buffer.from('ordinary output\r\n'.repeat(150)),
      ]));
      expect(fixture.panel.pendingReplyEmissions.size).toBe(1);
      expect(fixture.emitted).not.toHaveBeenCalled();
      fixture.close();
      expect(fixture.emitted).toHaveBeenCalledOnce();
      expect(fixture.emitted.mock.calls[0][0].content).toBe('Final response');
    } finally { fixture.dispose(); }
  });

  it('does not flush old output after an explicit kill', async () => {
    vi.useFakeTimers();
    const fixture = createPanel();
    try {
      fixture.panel.launchSession('synthetic', [], {}, true, 'internal');
      fixture.child.stdout.emit('data', frame());
      const termination = fixture.panel.killAgent();
      fixture.close();
      await termination;
      expect(fixture.emitted).not.toHaveBeenCalled();
      expect(fixture.panel.pendingTerminations.size).toBe(0);
    } finally { fixture.dispose(); }
  });

  it.each([false, true])(
    'routes a final authorized frame without reviving the exited source (replace target: %s)',
    async (replaceTarget) => {
      const source = createPanel();
      const target = createPanel(1);
      const manager = new AgentManager();
      const panels = [source.panel, target.panel];
      const layout = {
        allPanels: panels, hasPanel: (index: number) => Boolean(panels[index]),
        getPanel: (index: number) => panels[index],
        getTerminalPanel: (index: number) => panels[index],
        convertToTerminal: (index: number) => panels[index],
        setActivePanel: vi.fn(),
      };
      const orchestrator = new Orchestrator(layout as never, manager);
      (orchestrator as any).delay = async () => {};
      const sourceInputs: string[] = [];
      const targetInputs: string[] = [];
      source.child.stdin.on('data', (data) => sourceInputs.push(data.toString()));
      target.child.stdin.on('data', (data) => targetInputs.push(data.toString()));
      try {
        for (const panel of panels) {
          expect(manager.launchInternalAgent({ name: 'Synthetic', command: 'synthetic' }, panel)).toBe(true);
          orchestrator.connectPanel(panel);
        }
        const sourceId = manager.getAgentSessionId(0)!;
        const targetId = manager.getAgentSessionId(1)!;
        expect(orchestrator.armInternalProtocol(source.panel, capability)).toBe(true);
        source.child.stdout.emit('data', frame());
        source.close();
        expect(manager.getAgentSessionId(0)).toBeNull();
        if (replaceTarget) {
          // Replace the managed target identity before asynchronous submit.
          (manager as any).agents.get(1).sessionId = `${targetId}-replaced`;
        }
        for (let i = 0; i < 30 && (orchestrator as any).drainWork.size > 0; i++) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        expect((orchestrator as any).drainWork.size).toBe(0);
        const activity = orchestrator.getRecentActivity();
        expect(activity).toHaveLength(1);
        expect(activity[0]).toMatchObject({
          status: replaceTarget ? 'failed' : 'delivered', content: 'Final response',
          source: { sessionId: sourceId }, target: { sessionId: targetId },
        });
        if (!replaceTarget) expect(targetInputs.join('')).toContain('Final response');
        else expect(targetInputs.join('')).not.toContain('\r');
        expect(sourceInputs).toEqual([]);
        expect((orchestrator as any).ledger.claimReplyWindow(targetId)).toBeNull();
        expect((orchestrator as any).protocolCapabilities.has(sourceId)).toBe(false);
      } finally {
        source.close();
        target.close();
        await orchestrator.sealAndDrain();
        orchestrator.resetState();
        source.dispose();
        target.dispose();
      }
    },
  );
});
