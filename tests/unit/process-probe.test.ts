import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '../../src/doctor/process-probe.js';

describe('bounded diagnostic subprocesses', () => {
  it('rejects commands that are not absolute paths', async () => {
    const result = await runBoundedProcess('node', ['--version']);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('absolute path');
  });

  it('passes arguments literally without invoking a shell', async () => {
    const payload = '$(printf injected); echo unsafe';
    const result = await runBoundedProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1] ?? "")', payload],
    );

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe(payload);
  });

  it('caps captured output while continuing to drain the child process', async () => {
    const result = await runBoundedProcess(
      process.execPath,
      [
        '-e',
        'process.stdout.write("o".repeat(4096)); process.stderr.write("e".repeat(4096));',
      ],
      { maxOutputBytes: 64 },
    );

    expect(result.ok).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBe(64);
    expect(Buffer.byteLength(result.stderr)).toBe(64);
    expect(result.truncated).toBe(true);
  });

  it('terminates a subprocess that exceeds its deadline', async () => {
    const result = await runBoundedProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { timeoutMs: 25 },
    );

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('reports a missing absolute executable without rejecting', async () => {
    const result = await runBoundedProcess(
      path.join(path.parse(process.execPath).root, 'definitely-not-an-executable'),
      [],
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
