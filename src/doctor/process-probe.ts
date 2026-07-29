import { spawn } from 'node:child_process';
import path from 'node:path';

export interface ProcessProbeOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  /** Keep a private stdin pipe open for helpers that treat immediate EOF as cancellation. */
  keepStdinOpen?: boolean;
  /** Signal sent at the timeout boundary before SIGKILL escalation. */
  timeoutSignal?: NodeJS.Signals;
}

export interface ProcessProbeResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024;
const TERMINATION_GRACE_MS = 250;

export function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: ProcessProbeOptions = {},
): Promise<ProcessProbeResult> {
  if (!path.isAbsolute(command)) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      truncated: false,
      error: 'Diagnostic subprocess commands must use an absolute path',
    });
  }

  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxOutputBytes = Math.max(
    1,
    Math.trunc(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES),
  );

  return new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let escalationTimer: ReturnType<typeof setTimeout> | null = null;

    const child = spawn(command, [...args], {
      shell: false,
      stdio: [options.keepStdinOpen ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });

    const append = (
      chunks: Buffer[],
      currentBytes: number,
      chunk: Buffer | string,
    ): number => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxOutputBytes - currentBytes);
      if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
      if (bytes.length > remaining) truncated = true;
      return currentBytes + Math.min(bytes.length, remaining);
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBytes = append(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrBytes = append(stderrChunks, stderrBytes, chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill(options.timeoutSignal ?? 'SIGTERM');
      } catch {
        // The close/error handler below still settles the probe.
      }
      escalationTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The hard deadline below bounds even an unusual failed kill.
        }
      }, TERMINATION_GRACE_MS);
    }, timeoutMs);

    const hardDeadline = setTimeout(() => {
      finish(null, 'SIGKILL', 'Diagnostic subprocess did not terminate');
    }, timeoutMs + 500);

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error?: string,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(hardDeadline);
      if (escalationTimer) clearTimeout(escalationTimer);
      child.stdin?.destroy();
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({
        ok: !timedOut && !error && exitCode === 0,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        truncated,
        ...(error ? { error } : {}),
      });
    };

    child.once('error', (error) => {
      finish(null, null, error.message);
    });
    child.once('close', (exitCode, signal) => {
      finish(exitCode, signal);
    });
  });
}
