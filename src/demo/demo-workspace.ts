import { randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  installCleanupSignalGuard,
  type CleanupSignalGuard,
} from '../utils/cleanup-signal-guard.js';

const WORKSPACE_PREFIX = 'agents-commander-demo-';
const TOMBSTONE_PREFIX = '.agents-commander-demo-cleanup-';
const MAX_TOMBSTONE_RENAME_ATTEMPTS = 8;

export const DEMO_WORKSPACE_FILES: Readonly<Record<string, string>> = Object.freeze({
  'README.md': [
    '# Agents Commander — Conference Demo',
    '',
    'This temporary workspace is deterministic and fully offline.',
    '',
    '1. Confirm the launch prompt; Commander opens both local roles.',
    '2. The coordinator starts after both scanner-enabled sessions are ready.',
    '3. Watch SEND, STATUS, and REPLY complete, then press F12 for activity.',
    '',
  ].join('\n'),
  'brief.md': [
    '# Review brief',
    '',
    'Verify that `calculateTotal` returns the sum of line-item amounts.',
    'The demo reviewer should report a deterministic result without changing files.',
    '',
  ].join('\n'),
  'src/order-total.js': [
    'export function calculateTotal(amounts) {',
    '  return amounts.reduce((total, amount) => total + amount, 0);',
    '}',
    '',
  ].join('\n'),
  'tests/order-total.test.js': [
    "import assert from 'node:assert/strict';",
    "import { calculateTotal } from '../src/order-total.js';",
    '',
    'assert.equal(calculateTotal([19, 23]), 42);',
    '',
  ].join('\n'),
});

export interface DemoWorkspace {
  path: string;
  files: Readonly<Record<string, string>>;
  cleanup(): Promise<void>;
  transferSignalOwnership(): void;
}

interface WorkspaceIdentity {
  dev: number;
  ino: number;
}

interface WorkspaceCleanupState {
  tombstonePath: string | null;
  cleaned: boolean;
}

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function matchesWorkspaceIdentity(
  stat: { dev: number; ino: number; isDirectory(): boolean; isSymbolicLink(): boolean },
  identity: WorkspaceIdentity,
): boolean {
  return (
    stat.dev === identity.dev
    && stat.ino === identity.ino
    && stat.isDirectory()
    && !stat.isSymbolicLink()
  );
}

function createTombstonePath(workspacePath: string): string {
  return path.join(
    path.dirname(workspacePath),
    `${TOMBSTONE_PREFIX}${process.pid}-${randomUUID()}`,
  );
}

async function verifyOwnedDirectory(
  directoryPath: string,
  identity: WorkspaceIdentity,
  description: string,
): Promise<'missing' | 'owned'> {
  let current;
  try {
    current = await fs.lstat(directoryPath);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return 'missing';
    throw error;
  }

  if (!matchesWorkspaceIdentity(current, identity)) {
    throw new Error(`Refusing to clean a replaced demo ${description}: ${directoryPath}`);
  }
  return 'owned';
}

async function removeOwnedWorkspace(
  workspacePath: string,
  identity: WorkspaceIdentity | null,
  state: WorkspaceCleanupState,
): Promise<void> {
  if (state.cleaned) return;

  // If identity capture itself failed, no recursive deletion is safe: the
  // mkdtemp path may have been replaced before we could pin its inode.
  if (!identity) {
    throw new Error(`Refusing to clean a demo workspace without a verified identity: ${workspacePath}`);
  }

  if (!state.tombstonePath) {
    const sourceState = await verifyOwnedDirectory(workspacePath, identity, 'workspace');
    if (sourceState === 'missing') {
      state.cleaned = true;
      return;
    }

    let renameError: unknown = null;
    for (let attempt = 0; attempt < MAX_TOMBSTONE_RENAME_ATTEMPTS; attempt++) {
      const tombstonePath = createTombstonePath(workspacePath);
      try {
        // Renaming within the same parent first isolates the exact directory
        // entry. Recursive deletion never targets the reusable public path.
        await fs.rename(workspacePath, tombstonePath);
        state.tombstonePath = tombstonePath;
        renameError = null;
        break;
      } catch (error) {
        renameError = error;
        if (errnoCode(error) === 'EEXIST') continue;
        if (errnoCode(error) === 'ENOENT') {
          throw new Error(
            `Demo workspace changed while it was being isolated for cleanup: ${workspacePath}`,
            { cause: error },
          );
        }
        throw error;
      }
    }

    if (!state.tombstonePath) {
      throw new Error(
        `Unable to reserve a private demo cleanup tombstone for: ${workspacePath}`,
        { cause: renameError },
      );
    }
  }

  const tombstonePath = state.tombstonePath;
  const tombstoneState = await verifyOwnedDirectory(
    tombstonePath,
    identity,
    'workspace tombstone',
  );
  if (tombstoneState === 'missing') {
    state.tombstonePath = null;
    state.cleaned = true;
    return;
  }

  // The renamed directory retains its original 0700 mode. Reassert it only
  // after identity verification so a raced-in unrelated entry is never changed.
  await fs.chmod(tombstonePath, 0o700);
  await fs.rm(tombstonePath, { recursive: true, force: false });
  state.tombstonePath = null;
  state.cleaned = true;
}

export async function createDemoWorkspace(): Promise<DemoWorkspace> {
  // Creation is synchronous through identity capture so no termination signal
  // can land after the directory exists but before its cleanup guard is armed.
  const workspacePath = mkdtempSync(path.join(os.tmpdir(), WORKSPACE_PREFIX));
  const initialStat = lstatSync(workspacePath);
  const identity: WorkspaceIdentity | null = (
    initialStat.isDirectory() && !initialStat.isSymbolicLink()
  )
    ? { dev: initialStat.dev, ino: initialStat.ino }
    : null;
  const cleanupState: WorkspaceCleanupState = {
    tombstonePath: null,
    cleaned: false,
  };
  let cleanupPromise: Promise<void> | null = null;
  let signalGuard: CleanupSignalGuard | null = null;
  let creationCancelled = false;

  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    let guardedAttempt!: Promise<void>;
    guardedAttempt = removeOwnedWorkspace(workspacePath, identity, cleanupState)
      .finally(() => {
        signalGuard?.release();
        signalGuard = null;
      });
    cleanupPromise = guardedAttempt;
    void guardedAttempt.catch(() => {
      if (cleanupPromise === guardedAttempt) cleanupPromise = null;
    });
    return guardedAttempt;
  };

  signalGuard = installCleanupSignalGuard(() => {
    creationCancelled = true;
    return cleanup();
  });

  const assertCreationActive = (): void => {
    if (creationCancelled) {
      throw new Error('Demo workspace creation was interrupted by a termination signal');
    }
  };

  try {
    if (!identity) {
      throw new Error(`Temporary demo workspace is not a directory: ${workspacePath}`);
    }
    await fs.chmod(workspacePath, 0o700);
    assertCreationActive();

    const directories = new Set<string>();
    for (const relativePath of Object.keys(DEMO_WORKSPACE_FILES)) {
      let directory = path.dirname(relativePath);
      while (directory !== '.') {
        directories.add(directory);
        directory = path.dirname(directory);
      }
    }
    const orderedDirectories = [...directories].sort((left, right) => (
      left.split(path.sep).length - right.split(path.sep).length
      || left.localeCompare(right)
    ));
    for (const directory of orderedDirectories) {
      // Non-recursive creation cannot recreate the public workspace path if a
      // signal cleanup has already isolated it under its private tombstone.
      await fs.mkdir(path.join(workspacePath, directory));
      assertCreationActive();
    }
    for (const [relativePath, contents] of Object.entries(DEMO_WORKSPACE_FILES)) {
      await fs.writeFile(path.join(workspacePath, relativePath), contents, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      assertCreationActive();
    }
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Demo workspace creation failed and safe cleanup was refused: ${workspacePath}`,
      );
    }
    throw error;
  }

  return {
    path: workspacePath,
    files: DEMO_WORKSPACE_FILES,
    cleanup,
    transferSignalOwnership(): void {
      signalGuard?.release();
      signalGuard = null;
    },
  };
}
