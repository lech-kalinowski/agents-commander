import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalPanel } from '../../src/panels/terminal-panel.js';

function createShutdownHarness(
  child: ChildProcess | null,
  control: any = null,
): TerminalPanel {
  const panel: any = Object.create(TerminalPanel.prototype);
  Object.assign(panel, {
    proc: child,
    resizeControl: control,
    lastPtySize: null,
    stdoutDecoder: null,
    stderrDecoder: null,
    exitHandler: null,
    pendingTerminations: new Set<Promise<void>>(),
    shutdownPromise: null,
    launchSealed: false,
    scannerEnabled: true,
    instructionEchoGuardUntil: 1,
    activeGridProtocolKeys: new Set(['grid']),
    activeTailReplyKeys: new Set(['tail']),
    protocolReservations: new Map([['reservation', { remaining: 1, expiresAt: 1 }]]),
    pendingReplyEmissions: new Map(),
    gridScanTimer: null,
    commanderActivityTimer: null,
    commanderActivityLabel: null,
    agentName: 'Test Agent',
    _status: 'running',
    updateHeader: vi.fn(),
  });
  return panel;
}

const liveChildren = new Set<ChildProcess>();

afterEach(() => {
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  liveChildren.clear();
  vi.restoreAllMocks();
});

describe('TerminalPanel bounded shutdown', () => {
  it.skipIf(process.platform === 'win32')(
    'escalates a SIGINT/SIGTERM-resistant child through the helper force-kill command',
    async () => {
      const child = spawn(process.execPath, [
        '-e',
        [
          'process.on("SIGINT", () => {});',
          'process.on("SIGTERM", () => {});',
          'process.on("SIGUSR1", () => process.exit(137));',
          'process.stdout.write("ready\\n");',
          'setInterval(() => {}, 1000);',
        ].join(''),
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      liveChildren.add(child);
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.stdout?.once('data', () => resolve());
      });

      const originalKill = child.kill.bind(child);
      const kill = vi.fn((signal?: NodeJS.Signals | number) => originalKill(signal));
      child.kill = kill as typeof child.kill;
      const panel = createShutdownHarness(child);

      const first = panel.shutdownAgent({
        sigintGraceMs: 20,
        sigtermGraceMs: 20,
        sigkillGraceMs: 1000,
      });
      const second = panel.shutdownAgent({
        sigintGraceMs: 1,
        sigtermGraceMs: 1,
        sigkillGraceMs: 1,
      });

      expect(second).toBe(first);
      await first;

      expect(kill.mock.calls.map(([signal]) => signal)).toEqual([
        'SIGINT',
        'SIGTERM',
        'SIGUSR1',
      ]);
      expect(child.exitCode).toBe(137);
      expect((panel as any).proc).toBeNull();
      expect((panel as any)._status).toBe('exited');
      liveChildren.delete(child);
    },
  );

  it('settles within the configured bound when a child never reports close', async () => {
    const fakeChild = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const panel = createShutdownHarness(fakeChild);
    const startedAt = Date.now();

    const first = panel.shutdownAgent({
      sigintGraceMs: 5,
      sigtermGraceMs: 5,
      sigkillGraceMs: 5,
    });
    expect(panel.shutdownAgent()).toBe(first);
    await first;

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, 'SIGINT');
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, 'SIGTERM');
    expect(fakeChild.kill).toHaveBeenNthCalledWith(3, 'SIGUSR1');
    expect(fakeChild.kill).toHaveBeenNthCalledWith(4, 'SIGKILL');
    expect((panel as any).pendingTerminations.size).toBe(0);
  });

  it('requests group signals over fd 3 and redundantly force-kills through SIGUSR1', async () => {
    const fakeChild = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const control = {
      writable: true,
      destroyed: false,
      writableEnded: false,
      write: vi.fn(() => true),
      end: vi.fn(),
    };
    const panel = createShutdownHarness(fakeChild, control);

    await panel.shutdownAgent({
      sigintGraceMs: 1,
      sigtermGraceMs: 1,
      sigkillGraceMs: 1,
    });

    expect(control.write.mock.calls.map(([frame]) => frame)).toEqual([
      'signal INT\n',
      'signal TERM\n',
      'signal KILL\n',
    ]);
    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, 'SIGUSR1');
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    expect(control.end).toHaveBeenCalledOnce();
  });

  it('keeps retired panel terminations visible to the application-wide drain', async () => {
    const retiredChild = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const panel = createShutdownHarness(retiredChild);

    const termination = panel.killAgent();
    let drained = false;
    const drain = TerminalPanel.waitForPendingTerminations().then(() => {
      drained = true;
    });
    await Promise.resolve();

    expect(drained).toBe(false);
    (retiredChild as any).exitCode = 0;
    retiredChild.emit('close', 0, null);
    await Promise.all([drain, termination]);

    expect(drained).toBe(true);
    expect((panel as any).pendingTerminations.size).toBe(0);
  });

  it('irreversibly seals a panel against launches once shutdown begins', async () => {
    const panel = createShutdownHarness(null);

    await panel.shutdownAgent();

    expect(panel.launchCommand('late command', process.execPath)).toBe(false);
    expect((panel as any).launchSealed).toBe(true);
  });
});

describe('TerminalPanel checked input', () => {
  it('reports whether stdin accepted the write', () => {
    const write = vi.fn(() => false);
    const panel: any = Object.create(TerminalPanel.prototype);
    panel.agentName = 'Test Agent';
    panel.proc = {
      stdin: {
        writable: true,
        destroyed: false,
        writableEnded: false,
        write,
      },
    };

    expect(panel.sendInput('START\r')).toBe(true);
    expect(write).toHaveBeenCalledWith('START\r');

    panel.proc.stdin.writableEnded = true;
    expect(panel.sendInput('ignored')).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('returns false when stdin throws synchronously', () => {
    const panel: any = Object.create(TerminalPanel.prototype);
    panel.agentName = 'Test Agent';
    panel.proc = {
      stdin: {
        writable: true,
        destroyed: false,
        writableEnded: false,
        write: vi.fn(() => {
          throw new Error('closed');
        }),
      },
    };

    expect(panel.sendInput('START\r')).toBe(false);
  });
});
