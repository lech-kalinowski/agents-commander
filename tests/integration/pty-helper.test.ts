import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

const processStateProbe = process.platform === 'win32'
  ? null
  : spawnSync('ps', ['-o', 'stat=', '-p', String(process.pid)], { encoding: 'utf8' });
const canInspectProcessState = processStateProbe !== null
  && processStateProbe.error === undefined
  && processStateProbe.status === 0
  && typeof processStateProbe.stdout === 'string';

function processIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    return true;
  }
  const status = result.stdout.trim();
  return status.length > 0 && !status.startsWith('Z');
}

async function waitForProcessExit(pid: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processIsLive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (processIsLive(pid)) {
    throw new Error(`Process ${pid} remained alive after PTY group shutdown`);
  }
}

describe('PTY helper resize control', () => {
  it('applies fragmented resize frames and keeps running after malformed input', async () => {
    const helperPath = path.resolve('src/agents/pty-helper.py');
    const probe = [
      'import os',
      'import signal',
      'def resized(*_):',
      '    size = os.get_terminal_size(1)',
      '    print(f"SIZE {size.columns} {size.lines}", flush=True)',
      'signal.signal(signal.SIGWINCH, resized)',
      'print("READY", flush=True)',
      'while True:',
      '    signal.pause()',
    ].join('\n');

    const child = spawn(
      'python3',
      [helperPath, '--', 'python3', '-c', probe],
      {
        env: {
          ...process.env,
          COLUMNS: '20',
          LINES: '5',
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      },
    );
    const control = child.stdio[3] as Writable;
    let output = '';
    let requestSent = false;

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for PTY resize; output=${JSON.stringify(output)}`)),
          5000,
        );

        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code, signal) => {
          if (!output.includes('SIZE 100 40')) {
            clearTimeout(timer);
            reject(new Error(`PTY helper exited early: code=${code} signal=${signal}`));
          }
        });
        child.stdout?.on('data', (data: Buffer) => {
          output += data.toString('utf8');
          if (!requestSent && output.includes('READY')) {
            requestSent = true;
            control.write('not-a-command\n');
            control.write('resize 100 ');
            setImmediate(() => control.write('40\n'));
          }
          if (output.includes('SIZE 100 40')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      // Give an accidental second SIGWINCH enough time to trigger another
      // redraw before asserting the accepted resize produces one notification.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(output).toContain('READY');
      expect(output).toContain('SIZE 100 40');
      expect(output.match(/SIZE 100 40/g)).toHaveLength(1);
      expect(child.exitCode).toBeNull();
    } finally {
      control.end();
      child.kill('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([
          once(child, 'close'),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  }, 7000);

  it.skipIf(process.platform === 'win32')(
    'terminates the resistant PTY process group when its owning parent disappears',
    async () => {
      const helperPath = path.resolve('src/agents/pty-helper.py');
      const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-parent-loss-'));
      const heartbeatPath = path.join(fixtureRoot, 'worker-heartbeat');
      const worker = [
        'import signal',
        'import time',
        'signal.signal(signal.SIGHUP, signal.SIG_IGN)',
        'signal.signal(signal.SIGINT, signal.SIG_IGN)',
        'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
        `heartbeat = ${JSON.stringify(heartbeatPath)}`,
        'while True:',
        '    with open(heartbeat, "a", encoding="utf-8") as stream:',
        '        stream.write("x")',
        '    time.sleep(0.03)',
      ].join('\n');
      const agent = [
        'import os',
        'import signal',
        'import subprocess',
        'import sys',
        'import time',
        'signal.signal(signal.SIGHUP, signal.SIG_IGN)',
        'signal.signal(signal.SIGINT, signal.SIG_IGN)',
        'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
        `worker = subprocess.Popen([sys.executable, "-c", ${JSON.stringify(worker)}])`,
        `heartbeat = ${JSON.stringify(heartbeatPath)}`,
        'while not os.path.exists(heartbeat): time.sleep(0.01)',
        'print(f"READY {os.getpid()} {worker.pid}", flush=True)',
        'while True: signal.pause()',
      ].join('\n');
      const launcherCode = [
        'import os',
        'import select',
        'import subprocess',
        'import sys',
        `helper = subprocess.Popen([sys.executable, ${JSON.stringify(helperPath)}, "--", sys.executable, "-c", ${JSON.stringify(agent)}], stdin=subprocess.PIPE, stdout=sys.stdout, stderr=sys.stderr, env={**os.environ, "PYTHONUNBUFFERED": "1"})`,
        'print(f"HELPER {helper.pid}", flush=True)',
        // Parent loss must happen after both signal-resistant processes and
        // the heartbeat are ready, not after a machine-speed-dependent sleep.
        'ready, _, _ = select.select([sys.stdin], [], [], 5.0)',
        'if not ready: os._exit(2)',
        'command = os.read(sys.stdin.fileno(), 5)',
        'os._exit(0 if command == b"EXIT\\n" else 3)',
      ].join('\n');
      const launcher = spawn('python3', ['-c', launcherCode], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      launcher.stdin.on('error', () => {});
      const closePromise = once(launcher, 'close');
      let output = '';
      let helperPid = 0;
      let agentPid = 0;
      let readinessReceived = false;
      let cleanupCompleted = false;

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for orphan probe; output=${JSON.stringify(output)}`)),
            3000,
          );
          launcher.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          launcher.stdout?.on('data', (data: Buffer) => {
            output += data.toString('utf8');
            const helperMatch = output.match(/HELPER (\d+)/u);
            if (helperMatch) helperPid = Number(helperMatch[1]);
            const match = output.match(/READY (\d+) \d+/u);
            if (!match || readinessReceived) return;
            readinessReceived = true;
            clearTimeout(timer);
            agentPid = Number(match[1]);
            launcher.stdin.end('EXIT\n');
            resolve();
          });
        });

        const [code, signal] = await Promise.race([
          closePromise,
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error(`Orphaned PTY helper did not clean up; output=${JSON.stringify(output)}`)),
            4000,
          )),
        ]);
        expect(code).toBe(0);
        expect(signal).toBeNull();
        cleanupCompleted = true;

        const heartbeatSize = (await fs.stat(heartbeatPath)).size;
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect((await fs.stat(heartbeatPath)).size).toBe(heartbeatSize);
      } finally {
        if (agentPid > 0) {
          try {
            process.kill(-agentPid, 'SIGKILL');
          } catch {
            // The expected parent-loss cleanup already removed the group.
          }
        }
        if (!cleanupCompleted && helperPid > 0) {
          try {
            process.kill(helperPid, 'SIGKILL');
          } catch {
            // The helper may have finished while the failure was propagating.
          }
        }
        if (launcher.exitCode === null && launcher.signalCode === null) {
          launcher.kill('SIGKILL');
        }
        await fs.rm(fixtureRoot, { recursive: true, force: true });
      }
    },
    8000,
  );

  it.skipIf(process.platform === 'win32' || !canInspectProcessState)(
    'force-kills the actual PTY agent process group after INT and TERM are ignored',
    async () => {
      const helperPath = path.resolve('src/agents/pty-helper.py');
      const worker = [
        'import signal',
        'signal.signal(signal.SIGINT, signal.SIG_IGN)',
        'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
        'signal.pause()',
      ].join(';');
      const agent = [
        'import os',
        'import signal',
        'import subprocess',
        'import sys',
        'signal.signal(signal.SIGINT, signal.SIG_IGN)',
        'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
        `worker = subprocess.Popen([sys.executable, "-c", ${JSON.stringify(worker)}])`,
        'print(f"READY {os.getpid()} {worker.pid}", flush=True)',
        'while True: signal.pause()',
      ].join('\n');
      const helper = spawn(
        'python3',
        [helperPath, '--', 'python3', '-c', agent],
        {
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        },
      );
      const control = helper.stdio[3] as Writable;
      control.on('error', () => {});
      let output = '';
      let agentPid = 0;
      let workerPid = 0;

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for resistant PTY agent; output=${JSON.stringify(output)}`)),
            3000,
          );
          helper.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          helper.stdout?.on('data', (data: Buffer) => {
            output += data.toString('utf8');
            const match = output.match(/READY (\d+) (\d+)/u);
            if (!match) return;
            clearTimeout(timer);
            agentPid = Number(match[1]);
            workerPid = Number(match[2]);
            resolve();
          });
        });

        control.write('signal INT\n');
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(processIsLive(agentPid)).toBe(true);
        expect(processIsLive(workerPid)).toBe(true);

        control.write('signal TERM\n');
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(processIsLive(agentPid)).toBe(true);
        expect(processIsLive(workerPid)).toBe(true);

        control.write('signal KILL\n');
        await Promise.race([
          once(helper, 'close'),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('PTY helper did not close after process-group SIGKILL')),
            2000,
          )),
        ]);
        await Promise.all([
          waitForProcessExit(agentPid),
          waitForProcessExit(workerPid),
        ]);

        expect(processIsLive(agentPid)).toBe(false);
        expect(processIsLive(workerPid)).toBe(false);
      } finally {
        control.end();
        if (agentPid > 0) {
          try {
            process.kill(-agentPid, 'SIGKILL');
          } catch {
            // The expected group-kill path already removed it.
          }
        }
        if (helper.exitCode === null && helper.signalCode === null) {
          helper.kill('SIGKILL');
          await Promise.race([
            once(helper, 'close'),
            new Promise((resolve) => setTimeout(resolve, 1000)),
          ]);
        }
      }
    },
    8000,
  );
});
