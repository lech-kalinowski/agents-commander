import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

export function assertPrivate(stat: Stats, directory: boolean): void {
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Unsafe capture file type');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('Capture storage must be owned by the current user');
  }
  if ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) {
    throw new Error('Capture storage must have private permissions');
  }
  if (!directory && stat.nlink !== 1) throw new Error('Capture hard links are not allowed');
}

/** Never silently canonicalize a user-supplied symlink into an allowed path. */
export async function checkAncestors(directory: string): Promise<void> {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory) {
    throw new Error('Capture paths must be absolute and normalized');
  }
  const parts = directory.split(path.sep).filter(Boolean);
  let current = path.parse(directory).root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Capture directory symlinks are not allowed');
  }
}

export async function makePrivateDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  try {
    await checkAncestors(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await makePrivateDirectory(parent);
  }
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await checkAncestors(directory);
  assertPrivate(await lstat(directory), true);
}

export async function openPrivateFile(file: string, create = false): Promise<FileHandle> {
  await checkAncestors(path.dirname(file));
  assertPrivate(await lstat(path.dirname(file)), true);
  const before = create ? undefined : await lstat(file);
  if (before) assertPrivate(before, false);
  const handle = await open(file, (create
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    : constants.O_RDONLY) | NOFOLLOW | NONBLOCK, 0o600);
  try {
    const opened = await handle.stat();
    assertPrivate(opened, false);
    const after = await lstat(file);
    assertPrivate(after, false);
    if (opened.dev !== after.dev || opened.ino !== after.ino
      || (before && (before.dev !== opened.dev || before.ino !== opened.ino))) {
      throw new Error('Capture file changed during open');
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readPrivateFile(file: string, maxBytes: number): Promise<Buffer> {
  const handle = await openPrivateFile(file);
  try {
    const before = await handle.stat();
    if (before.size > maxBytes) throw new Error('Capture file exceeds its read limit');
    const buffer = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Capture file changed during read');
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}
