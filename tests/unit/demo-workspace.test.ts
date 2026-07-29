import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createDemoWorkspace,
  DEMO_WORKSPACE_FILES,
} from '../../src/demo/demo-workspace.js';

describe('createDemoWorkspace', () => {
  it('creates a private workspace with the exact deterministic seed files', async () => {
    const workspace = await createDemoWorkspace();

    try {
      const stat = await fs.lstat(workspace.path);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o700);

      const discovered: string[] = [];
      async function walk(directory: string): Promise<void> {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const absolutePath = path.join(directory, entry.name);
          const relativePath = path.relative(workspace.path, absolutePath);
          if (entry.isDirectory()) {
            await walk(absolutePath);
          } else {
            discovered.push(relativePath);
          }
        }
      }
      await walk(workspace.path);

      expect(discovered.sort()).toEqual(Object.keys(DEMO_WORKSPACE_FILES).sort());
      for (const [relativePath, expected] of Object.entries(DEMO_WORKSPACE_FILES)) {
        await expect(fs.readFile(
          path.join(workspace.path, relativePath),
          'utf8',
        )).resolves.toBe(expected);
      }
    } finally {
      await workspace.cleanup();
    }
  });

  it('cleans only its owned workspace and cleanup is idempotent', async () => {
    const workspace = await createDemoWorkspace();
    const sibling = `${workspace.path}-keep`;
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(sibling, 'keep.txt'), 'keep');

    try {
      const first = workspace.cleanup();
      const second = workspace.cleanup();
      expect(second).toBe(first);
      await Promise.all([first, second]);
      await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(workspace.cleanup()).resolves.toBeUndefined();
      await expect(fs.readFile(path.join(sibling, 'keep.txt'), 'utf8'))
        .resolves.toBe('keep');
    } finally {
      await fs.rm(sibling, { recursive: true, force: true });
    }
  });

  it('arms signal cleanup before asynchronous seed writes begin', async () => {
    const originalWriteFile = fs.writeFile.bind(fs);
    const listenersBefore = new Set(process.listeners('SIGTERM'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    let releaseWrite!: () => void;
    let reportWriteStarted!: () => void;
    let workspacePath: string | null = null;
    const writeStarted = new Promise<void>((resolve) => {
      reportWriteStarted = resolve;
    });
    const blockedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementationOnce(
      async (filePath, ...arguments_) => {
        workspacePath = path.dirname(String(filePath));
        reportWriteStarted();
        await blockedWrite;
        return originalWriteFile(filePath, ...arguments_);
      },
    );

    try {
      const creationResult = createDemoWorkspace().then(
        (workspace) => workspace,
        (error: unknown) => error,
      );
      await writeStarted;

      const signalListeners = process.listeners('SIGTERM')
        .filter((listener) => !listenersBefore.has(listener));
      expect(signalListeners).toHaveLength(1);
      (signalListeners[0] as () => void)();

      await vi.waitFor(() => {
        expect(exit).toHaveBeenCalledWith(143);
      });
      releaseWrite();

      const result = await creationResult;
      expect(result).toBeInstanceOf(Error);
      expect(workspacePath).not.toBeNull();
      await expect(fs.lstat(workspacePath!)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        process.listeners('SIGTERM').filter((listener) => !listenersBefore.has(listener)),
      ).toHaveLength(0);
    } finally {
      releaseWrite?.();
      writeSpy.mockRestore();
      exit.mockRestore();
      if (workspacePath) {
        await fs.rm(workspacePath, { recursive: true, force: true });
      }
    }
  });

  it('retries a failed tombstone removal without renaming the public path again', async () => {
    const workspace = await createDemoWorkspace();
    const originalRename = fs.rename.bind(fs);
    const originalRm = fs.rm.bind(fs);
    let tombstonePath: string | null = null;
    let failRemoval = true;
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(
      async (source, destination) => {
        tombstonePath = String(destination);
        await originalRename(source, destination);
      },
    );
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(
      async (target, options) => {
        if (failRemoval) {
          failRemoval = false;
          throw Object.assign(new Error('simulated busy tombstone'), { code: 'EBUSY' });
        }
        await originalRm(target, options);
      },
    );

    try {
      await expect(workspace.cleanup()).rejects.toMatchObject({ code: 'EBUSY' });
      expect(tombstonePath).not.toBeNull();
      await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.lstat(tombstonePath!)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });

      await expect(workspace.cleanup()).resolves.toBeUndefined();
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(rmSpy).toHaveBeenCalledTimes(2);
      await expect(fs.lstat(tombstonePath!)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      renameSpy.mockRestore();
      rmSpy.mockRestore();
      await fs.rm(workspace.path, { recursive: true, force: true });
      if (tombstonePath) {
        await fs.rm(tombstonePath, { recursive: true, force: true });
      }
    }
  });

  it('does not touch a replacement installed at the original path', async () => {
    const workspace = await createDemoWorkspace();
    const ownedPath = `${workspace.path}-owned`;
    await fs.rename(workspace.path, ownedPath);
    await fs.mkdir(workspace.path, { mode: 0o700 });
    await fs.writeFile(path.join(workspace.path, 'replacement.txt'), 'must survive');

    try {
      await expect(workspace.cleanup()).rejects.toThrow(
        'Refusing to clean a replaced demo workspace',
      );
      await expect(fs.readFile(
        path.join(workspace.path, 'replacement.txt'),
        'utf8',
      )).resolves.toBe('must survive');
      await expect(fs.lstat(ownedPath)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
    } finally {
      await fs.rm(workspace.path, { recursive: true, force: true });
      await fs.rm(ownedPath, { recursive: true, force: true });
    }
  });

  it('refuses a replacement raced in during rename and never recursively deletes it', async () => {
    const workspace = await createDemoWorkspace();
    const originalRename = fs.rename.bind(fs);
    const ownedPath = `${workspace.path}-owned-race`;
    let tombstonePath: string | null = null;
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementationOnce(
      async (source, destination) => {
        tombstonePath = String(destination);
        await originalRename(source, ownedPath);
        await fs.mkdir(String(source), { mode: 0o700 });
        await fs.writeFile(path.join(String(source), 'replacement.txt'), 'must survive');
        await originalRename(source, destination);
      },
    );

    try {
      await expect(workspace.cleanup()).rejects.toThrow(
        'Refusing to clean a replaced demo workspace tombstone',
      );
      expect(tombstonePath).not.toBeNull();
      await expect(fs.readFile(
        path.join(tombstonePath!, 'replacement.txt'),
        'utf8',
      )).resolves.toBe('must survive');
      await expect(fs.lstat(ownedPath)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
    } finally {
      renameSpy.mockRestore();
      await fs.rm(workspace.path, { recursive: true, force: true });
      await fs.rm(ownedPath, { recursive: true, force: true });
      if (tombstonePath) {
        await fs.rm(tombstonePath, { recursive: true, force: true });
      }
    }
  });

  it('re-verifies a retained tombstone before retrying recursive removal', async () => {
    const workspace = await createDemoWorkspace();
    const originalRename = fs.rename.bind(fs);
    const originalRm = fs.rm.bind(fs);
    let tombstonePath: string | null = null;
    let failRemoval = true;
    const movedOwnedTombstone = `${workspace.path}-owned-tombstone`;
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(
      async (source, destination) => {
        tombstonePath = String(destination);
        await originalRename(source, destination);
      },
    );
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(
      async (target, options) => {
        if (failRemoval) {
          failRemoval = false;
          throw Object.assign(new Error('simulated busy tombstone'), { code: 'EBUSY' });
        }
        await originalRm(target, options);
      },
    );

    try {
      await expect(workspace.cleanup()).rejects.toMatchObject({ code: 'EBUSY' });
      expect(tombstonePath).not.toBeNull();
      await originalRename(tombstonePath!, movedOwnedTombstone);
      await fs.mkdir(tombstonePath!, { mode: 0o700 });
      await fs.writeFile(path.join(tombstonePath!, 'replacement.txt'), 'must survive');

      await expect(workspace.cleanup()).rejects.toThrow(
        'Refusing to clean a replaced demo workspace tombstone',
      );
      expect(rmSpy).toHaveBeenCalledTimes(1);
      await expect(fs.readFile(
        path.join(tombstonePath!, 'replacement.txt'),
        'utf8',
      )).resolves.toBe('must survive');
      await expect(fs.lstat(movedOwnedTombstone)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
    } finally {
      renameSpy.mockRestore();
      rmSpy.mockRestore();
      await fs.rm(workspace.path, { recursive: true, force: true });
      await fs.rm(movedOwnedTombstone, { recursive: true, force: true });
      if (tombstonePath) {
        await fs.rm(tombstonePath, { recursive: true, force: true });
      }
    }
  });

  it('removes the verified workspace through a tombstone when seed creation fails', async () => {
    let workspacePath: string | null = null;
    const writeFailure = Object.assign(new Error('simulated seed failure'), {
      code: 'EIO',
    });
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementationOnce(
      async (filePath, ..._arguments) => {
        workspacePath = path.dirname(String(filePath));
        throw writeFailure;
      },
    );

    try {
      await expect(createDemoWorkspace()).rejects.toBe(writeFailure);
      expect(workspacePath).not.toBeNull();
      await expect(fs.lstat(workspacePath!)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      writeSpy.mockRestore();
      if (workspacePath) {
        await fs.rm(workspacePath, { recursive: true, force: true });
      }
    }
  });

  it('never recursively removes a replacement root after seed creation fails', async () => {
    const originalWriteFile = fs.writeFile.bind(fs);
    let workspacePath: string | null = null;
    let movedOriginalPath: string | null = null;
    const writeFailure = Object.assign(new Error('simulated seed failure'), {
      code: 'EIO',
    });
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementationOnce(
      async (filePath, ..._arguments) => {
        workspacePath = path.dirname(String(filePath));
        movedOriginalPath = `${workspacePath}-original`;
        await fs.rename(workspacePath, movedOriginalPath);
        await fs.mkdir(workspacePath, { mode: 0o700 });
        await originalWriteFile(
          path.join(workspacePath, 'replacement.txt'),
          'must survive',
        );
        throw writeFailure;
      },
    );

    try {
      const error = await createDemoWorkspace().catch(
        (workspaceError: unknown) => workspaceError,
      );
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(writeFailure);
      expect((error as Error).message).toContain('safe cleanup was refused');
      expect(workspacePath).not.toBeNull();
      await expect(fs.readFile(
        path.join(workspacePath!, 'replacement.txt'),
        'utf8',
      )).resolves.toBe('must survive');
      expect(movedOriginalPath).not.toBeNull();
      await expect(fs.lstat(movedOriginalPath!)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
    } finally {
      writeSpy.mockRestore();
      if (workspacePath) {
        await fs.rm(workspacePath, { recursive: true, force: true });
      }
      if (movedOriginalPath) {
        await fs.rm(movedOriginalPath, { recursive: true, force: true });
      }
    }
  });
});
