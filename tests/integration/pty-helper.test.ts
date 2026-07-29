import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

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
});
