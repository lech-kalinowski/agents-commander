export type CleanupSignal = 'SIGINT' | 'SIGHUP' | 'SIGTERM';

const CLEANUP_SIGNALS: ReadonlyArray<Readonly<{
  signal: CleanupSignal;
  exitCode: number;
}>> = Object.freeze([
  { signal: 'SIGINT', exitCode: 130 },
  { signal: 'SIGHUP', exitCode: 129 },
  { signal: 'SIGTERM', exitCode: 143 },
]);

export interface CleanupSignalTarget {
  on(signal: CleanupSignal, listener: () => void): unknown;
  removeListener(signal: CleanupSignal, listener: () => void): unknown;
}

export interface CleanupSignalGuard {
  release(): void;
}

export interface CleanupSignalGuardOptions {
  target?: CleanupSignalTarget;
  exit?: (exitCode: number) => void;
  reportError?: (message: string) => void;
}

/**
 * Temporarily owns termination signals while a resource is being transferred
 * to a longer-lived owner. All supported signals remain consumed until the
 * guard is released, and cleanup is started at most once.
 */
export function installCleanupSignalGuard(
  cleanup: () => void | Promise<void>,
  options: CleanupSignalGuardOptions = {},
): CleanupSignalGuard {
  const target = options.target ?? process;
  const exit = options.exit ?? ((exitCode) => { process.exit(exitCode); });
  const reportError = options.reportError ?? ((message) => {
    process.stderr.write(`${message}\n`);
  });
  const handlers = new Map<CleanupSignal, () => void>();
  let released = false;
  let cleanupStarted = false;

  for (const { signal, exitCode } of CLEANUP_SIGNALS) {
    const handler = () => {
      if (released || cleanupStarted) return;
      cleanupStarted = true;
      void Promise.resolve()
        .then(cleanup)
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          reportError(`Failed to clean the offline demo workspace after ${signal}: ${detail}`);
        })
        .finally(() => {
          exit(exitCode);
        });
    };
    handlers.set(signal, handler);
    target.on(signal, handler);
  }

  return {
    release(): void {
      if (released) return;
      released = true;
      for (const [signal, handler] of handlers) {
        target.removeListener(signal, handler);
      }
      handlers.clear();
    },
  };
}
