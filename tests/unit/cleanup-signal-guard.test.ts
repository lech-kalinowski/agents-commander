import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  installCleanupSignalGuard,
  type CleanupSignalTarget,
} from '../../src/utils/cleanup-signal-guard.js';

function signalTarget(): EventEmitter & CleanupSignalTarget {
  return new EventEmitter() as EventEmitter & CleanupSignalTarget;
}

describe('installCleanupSignalGuard', () => {
  it('cleans once, consumes repeated signals, and preserves the first exit code', async () => {
    const target = signalTarget();
    let releaseCleanup!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    }));
    const exit = vi.fn();
    const guard = installCleanupSignalGuard(cleanup, { target, exit });

    target.emit('SIGTERM');
    await Promise.resolve();
    target.emit('SIGINT');

    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();

    releaseCleanup();
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(143);
    });
    expect(exit).toHaveBeenCalledOnce();
    guard.release();
  });

  it('removes every temporary signal listener when ownership transfers', async () => {
    const target = signalTarget();
    const cleanup = vi.fn();
    const exit = vi.fn();
    const guard = installCleanupSignalGuard(cleanup, { target, exit });

    guard.release();
    guard.release();
    target.emit('SIGINT');
    await Promise.resolve();

    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(target.listenerCount('SIGINT')).toBe(0);
    expect(target.listenerCount('SIGHUP')).toBe(0);
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });

  it('reports cleanup failure but still exits with signal semantics', async () => {
    const target = signalTarget();
    const reportError = vi.fn();
    const exit = vi.fn();
    const guard = installCleanupSignalGuard(
      async () => {
        throw new Error('cleanup refused');
      },
      { target, exit, reportError },
    );

    target.emit('SIGHUP');
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(129);
    });

    expect(reportError).toHaveBeenCalledWith(
      expect.stringMatching(/SIGHUP.*cleanup refused/u),
    );
    guard.release();
  });
});
