import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';

export const MAX_EDITOR_FILE_BYTES = 1024 * 1024;
const DEFAULT_LOCK_TIMEOUT_MS = 1000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_STALE_LOCK_MS = 30_000;
const saveQueues = new Map<string, Promise<void>>();

export type EditorLineEnding = '\n' | '\r\n' | '\r';

export type EditorFileErrorCode =
  | 'not-found'
  | 'not-regular'
  | 'symlink'
  | 'too-large'
  | 'binary'
  | 'invalid-utf8'
  | 'changed'
  | 'metadata'
  | 'io';

export class EditorFileError extends Error {
  constructor(
    public readonly code: EditorFileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EditorFileError';
  }
}

export interface EditorFileBaseline {
  /** SHA-256 of the exact bytes read from or written to disk. */
  contentHash: string;
  /** Permission and special mode bits, without the file-type bits. */
  mode: number;
  device: number;
  inode: number;
  userId: number;
  groupId: number;
  hasBom: boolean;
  lineEnding: EditorLineEnding;
  hadFinalNewline: boolean;
}

export interface LoadedEditorFile {
  /** UTF-8 text with line endings normalized to LF and the BOM removed. */
  content: string;
  baseline: EditorFileBaseline;
}

interface RawEditorFile {
  bytes: Buffer;
  mode: number;
  device: number;
  inode: number;
  userId: number;
  groupId: number;
}

interface EditorFileIOOptions {
  maxBytes?: number;
  makeNonce?: () => string;
  copyMetadata?: (source: FileHandle, destination: FileHandle) => Promise<void>;
  beforeMetadataCopy?: (temporaryPath: string) => Promise<void>;
  beforeCommit?: (temporaryPath: string, lockPath: string) => Promise<void>;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  staleLockMs?: number;
}

interface FileIdentity {
  device: number;
  inode: number;
}

interface OwnedFile {
  path: string;
  handle: FileHandle;
  identity: FileIdentity;
}

interface SaveLockRecord {
  version: 1;
  pid: number;
  hostname: string;
  createdAt: number;
  token: string;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function detectLineEnding(text: string): EditorLineEnding {
  const match = text.match(/\r\n|\n|\r/);
  return (match?.[0] as EditorLineEnding | undefined) ?? '\n';
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

function encodeDocument(content: string, baseline: EditorFileBaseline): Buffer {
  const withOriginalLineEndings = baseline.lineEnding === '\n'
    ? content
    : content.replace(/\n/g, baseline.lineEnding);
  const text = baseline.hasBom ? `\uFEFF${withOriginalLineEndings}` : withOriginalLineEndings;
  return Buffer.from(text, 'utf8');
}

function matchesBaseline(raw: RawEditorFile, baseline: EditorFileBaseline): boolean {
  return contentHash(raw.bytes) === baseline.contentHash
    && raw.mode === baseline.mode
    && raw.device === baseline.device
    && raw.inode === baseline.inode
    && raw.userId === baseline.userId
    && raw.groupId === baseline.groupId;
}

function sameIdentity(
  actual: Pick<Awaited<ReturnType<typeof fs.lstat>>, 'dev' | 'ino'>,
  expected: FileIdentity,
): boolean {
  return actual.dev === expected.device && actual.ino === expected.inode;
}

async function serializeSave<T>(
  baseline: EditorFileBaseline,
  operation: () => Promise<T>,
): Promise<T> {
  // The inode key also serializes two paths that are hard links to one file.
  const key = `${baseline.device}:${baseline.inode}`;
  const previous = saveQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  saveQueues.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (saveQueues.get(key) === tail) saveQueues.delete(key);
  }
}

async function copyFileMetadata(source: FileHandle, destination: FileHandle): Promise<void> {
  let args: string[];
  if (process.platform === 'darwin') {
    // Both paths resolve only to inherited, already-validated descriptors.
    args = ['-p', '--', '/dev/fd/3', '/dev/fd/4'];
  } else if (process.platform === 'linux') {
    args = [
      '--preserve=all',
      '--no-target-directory',
      '--',
      '/proc/self/fd/3',
      '/proc/self/fd/4',
    ];
  } else {
    throw new EditorFileError(
      'metadata',
      'File metadata cannot be preserved on this platform; save cancelled',
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('/bin/cp', args, {
      stdio: ['ignore', 'ignore', 'pipe', source.fd, destination.fd],
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Metadata copy exited with status ${code ?? 'unknown'}`));
      }
    });
  });
}

function isSaveLockRecord(value: unknown): value is SaveLockRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SaveLockRecord>;
  return record.version === 1
    && Number.isSafeInteger(record.pid)
    && (record.pid ?? 0) > 0
    && typeof record.hostname === 'string'
    && record.hostname.length > 0
    && Number.isSafeInteger(record.createdAt)
    && (record.createdAt ?? 0) > 0
    && typeof record.token === 'string'
    && /^[a-f0-9]{24}$/.test(record.token);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error) || error.code !== 'ESRCH';
  }
}

async function writeBytesAtStart(handle: FileHandle, bytes: Buffer): Promise<void> {
  await handle.truncate(0);
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, written);
    if (result.bytesWritten <= 0) {
      throw new Error('Unable to write the complete temporary file');
    }
    written += result.bytesWritten;
  }
  await handle.truncate(bytes.length);
}

export function editorFileErrorMessage(error: unknown): string {
  if (error instanceof EditorFileError) return error.message;
  return 'Unable to access the file';
}

/**
 * Race-aware file I/O for the built-in editor.
 *
 * The service owns every temporary path it creates and never removes a
 * candidate that it did not successfully open with O_EXCL.
 */
export class EditorFileIO {
  private readonly maxBytes: number;
  private readonly makeNonce: () => string;
  private readonly copyMetadata: (source: FileHandle, destination: FileHandle) => Promise<void>;
  private readonly beforeMetadataCopy?: (temporaryPath: string) => Promise<void>;
  private readonly beforeCommit?: (temporaryPath: string, lockPath: string) => Promise<void>;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly staleLockMs: number;

  constructor(options: EditorFileIOOptions = {}) {
    this.maxBytes = options.maxBytes ?? MAX_EDITOR_FILE_BYTES;
    this.makeNonce = options.makeNonce ?? (() => randomBytes(12).toString('hex'));
    this.copyMetadata = options.copyMetadata ?? copyFileMetadata;
    this.beforeMetadataCopy = options.beforeMetadataCopy;
    this.beforeCommit = options.beforeCommit;
    this.lockTimeoutMs = Math.max(0, Math.trunc(
      options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
    ));
    this.lockRetryMs = Math.max(1, Math.trunc(
      options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS,
    ));
    this.staleLockMs = Math.max(1000, Math.trunc(
      options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
    ));
  }

  async load(filePath: string): Promise<LoadedEditorFile> {
    let raw: RawEditorFile;
    try {
      raw = await this.readRegularFile(filePath);
    } catch (error) {
      throw this.asLoadError(error);
    }

    if (raw.bytes.includes(0)) {
      throw new EditorFileError('binary', 'Files containing NUL bytes cannot be edited');
    }

    const hasBom = raw.bytes.length >= 3
      && raw.bytes[0] === 0xef
      && raw.bytes[1] === 0xbb
      && raw.bytes[2] === 0xbf;
    const textBytes = hasBom ? raw.bytes.subarray(3) : raw.bytes;

    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(textBytes);
    } catch (error) {
      throw new EditorFileError('invalid-utf8', 'Only valid UTF-8 text files can be edited', {
        cause: error,
      });
    }

    const lineEnding = detectLineEnding(decoded);
    const hadFinalNewline = /(?:\r\n|\n|\r)$/.test(decoded);

    return {
      content: normalizeLineEndings(decoded),
      baseline: {
        contentHash: contentHash(raw.bytes),
        mode: raw.mode,
        device: raw.device,
        inode: raw.inode,
        userId: raw.userId,
        groupId: raw.groupId,
        hasBom,
        lineEnding,
        hadFinalNewline,
      },
    };
  }

  async save(
    filePath: string,
    content: string,
    baseline: EditorFileBaseline,
  ): Promise<EditorFileBaseline> {
    const bytes = encodeDocument(content, baseline);
    if (bytes.length > this.maxBytes) {
      throw new EditorFileError('too-large', 'Edited content exceeds the 1 MiB limit');
    }

    return serializeSave(baseline, () => this.saveSerialized(filePath, bytes, content, baseline));
  }

  private async saveSerialized(
    filePath: string,
    bytes: Buffer,
    content: string,
    baseline: EditorFileBaseline,
  ): Promise<EditorFileBaseline> {
    let tempPath: string | null = null;
    let tempHandle: FileHandle | null = null;
    let ownedIdentity: FileIdentity | null = null;
    let sourceHandle: FileHandle | null = null;
    let saveLock: OwnedFile | null = null;

    try {
      saveLock = await this.acquireSaveLock(filePath);
      const initial = await this.readCurrentBaseline(filePath);
      if (!matchesBaseline(initial, baseline)) {
        throw new EditorFileError(
          'changed',
          'The file changed outside Agents Commander; reload before saving',
        );
      }

      const created = await this.createExclusiveTemp(filePath, baseline.mode);
      tempPath = created.tempPath;
      tempHandle = created.handle;
      ownedIdentity = created.identity;

      sourceHandle = await this.openBaselineHandle(filePath, baseline);
      if (this.beforeMetadataCopy) await this.beforeMetadataCopy(tempPath);
      try {
        await this.copyMetadata(sourceHandle, tempHandle);
      } catch (error) {
        if (error instanceof EditorFileError) throw error;
        throw new EditorFileError(
          'metadata',
          'File metadata could not be preserved; save cancelled',
          { cause: error },
        );
      }
      await sourceHandle.close();
      sourceHandle = null;

      await this.assertOwnedTemp(tempPath, ownedIdentity);
      const copiedStat = await tempHandle.stat();
      if (copiedStat.uid !== baseline.userId || copiedStat.gid !== baseline.groupId) {
        await tempHandle.chown(baseline.userId, baseline.groupId);
      }
      // cp reports descriptor-access bits on some platforms. Restore the exact
      // source mode through the owned descriptor, after chown (which may clear
      // set-id bits), without touching the replaceable pathname.
      await tempHandle.chmod(baseline.mode);
      await writeBytesAtStart(tempHandle, bytes);
      await tempHandle.sync();
      const savedStat = await tempHandle.stat();
      if (
        !sameIdentity(savedStat, ownedIdentity)
        || (savedStat.mode & 0o7777) !== baseline.mode
        || savedStat.uid !== baseline.userId
        || savedStat.gid !== baseline.groupId
      ) {
        throw new EditorFileError(
          'metadata',
          'File ownership or permissions could not be preserved; save cancelled',
        );
      }

      const current = await this.readCurrentBaseline(filePath);
      if (!matchesBaseline(current, baseline)) {
        throw new EditorFileError(
          'changed',
          'The file changed outside Agents Commander; reload before saving',
        );
      }

      if (this.beforeCommit) await this.beforeCommit(tempPath, saveLock.path);

      // The handle remains open. Verify that the directory entry still names
      // our inode and that the cross-process lock is still ours immediately
      // before the atomic replacement.
      await this.assertOwnedPath(
        saveLock.path,
        saveLock.identity,
        'The editor save lock changed; save cancelled',
      );
      await this.assertOwnedTemp(tempPath, ownedIdentity);

      // This must remain the final awaited operation before rename. Hooks and
      // ownership checks above can yield long enough for a non-cooperating
      // writer to replace the target.
      const finalCurrent = await this.readCurrentBaseline(filePath);
      if (!matchesBaseline(finalCurrent, baseline)) {
        throw new EditorFileError(
          'changed',
          'The file changed outside Agents Commander; reload before saving',
        );
      }
      await fs.rename(tempPath, filePath);
      tempPath = null;

      return {
        ...baseline,
        contentHash: contentHash(bytes),
        device: ownedIdentity.device,
        inode: ownedIdentity.inode,
        hadFinalNewline: content.endsWith('\n'),
      };
    } catch (error) {
      if (error instanceof EditorFileError) throw error;
      throw new EditorFileError('io', 'Unable to save the file safely', { cause: error });
    } finally {
      if (sourceHandle) {
        await sourceHandle.close().catch(() => undefined);
      }
      if (tempHandle) {
        try {
          await tempHandle.close();
        } catch {
          // Cleanup below is still safe because tempPath is owned by this call.
        }
      }
      if (tempPath && ownedIdentity) {
        await this.unlinkIfOwned(tempPath, ownedIdentity);
      }
      if (saveLock) {
        await this.releaseSaveLock(saveLock);
      }
    }
  }

  private async readCurrentBaseline(filePath: string): Promise<RawEditorFile> {
    try {
      return await this.readRegularFile(filePath);
    } catch (error) {
      if (error instanceof EditorFileError && error.code === 'not-found') {
        throw new EditorFileError('changed', 'The file disappeared; reload before saving', {
          cause: error,
        });
      }
      if (error instanceof EditorFileError && error.code === 'changed') throw error;
      throw new EditorFileError(
        'changed',
        'The file changed outside Agents Commander; reload before saving',
        { cause: error },
      );
    }
  }

  private async readRegularFile(filePath: string): Promise<RawEditorFile> {
    let entry;
    try {
      entry = await fs.lstat(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new EditorFileError('not-found', 'The file no longer exists', { cause: error });
      }
      throw error;
    }

    if (entry.isSymbolicLink()) {
      throw new EditorFileError('symlink', 'Symbolic links cannot be edited');
    }
    if (!entry.isFile()) {
      throw new EditorFileError('not-regular', 'Only regular files can be edited');
    }
    if (entry.size > this.maxBytes) {
      throw new EditorFileError('too-large', 'Files larger than 1 MiB cannot be edited');
    }

    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let handle: FileHandle | null = null;
    try {
      handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
      const opened = await handle.stat();
      if (!opened.isFile()) {
        throw new EditorFileError('not-regular', 'Only regular files can be edited');
      }
      if (opened.size > this.maxBytes) {
        throw new EditorFileError('too-large', 'Files larger than 1 MiB cannot be edited');
      }
      const bytes = await handle.readFile();
      if (bytes.length > this.maxBytes) {
        throw new EditorFileError('too-large', 'Files larger than 1 MiB cannot be edited');
      }
      return {
        bytes,
        mode: opened.mode & 0o7777,
        device: opened.dev,
        inode: opened.ino,
        userId: opened.uid,
        groupId: opened.gid,
      };
    } finally {
      if (handle) await handle.close();
    }
  }

  private async openBaselineHandle(
    filePath: string,
    baseline: EditorFileBaseline,
  ): Promise<FileHandle> {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let handle: FileHandle | null = null;
    try {
      handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
      const opened = await handle.stat();
      if (
        !opened.isFile()
        || (opened.mode & 0o7777) !== baseline.mode
        || opened.dev !== baseline.device
        || opened.ino !== baseline.inode
        || opened.uid !== baseline.userId
        || opened.gid !== baseline.groupId
      ) {
        throw new EditorFileError(
          'changed',
          'The file changed outside Agents Commander; reload before saving',
        );
      }
      return handle;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (error instanceof EditorFileError) throw error;
      throw new EditorFileError(
        'changed',
        'The file changed outside Agents Commander; reload before saving',
        { cause: error },
      );
    }
  }

  private async acquireSaveLock(filePath: string): Promise<OwnedFile> {
    const lockPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.agents-commander.lock`,
    );
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      let handle: FileHandle | null = null;
      try {
        handle = await fs.open(lockPath, flags, 0o600);
        const opened = await handle.stat();
        const identity = { device: opened.dev, inode: opened.ino };
        const record: SaveLockRecord = {
          version: 1,
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: Date.now(),
          token: randomBytes(12).toString('hex'),
        };
        await handle.writeFile(`${JSON.stringify(record)}\n`);
        await handle.sync();
        await this.assertOwnedPath(
          lockPath,
          identity,
          'The editor save lock changed; save cancelled',
        );
        return { path: lockPath, handle, identity };
      } catch (error) {
        if (handle) {
          let identity: FileIdentity | null = null;
          try {
            const opened = await handle.stat();
            identity = { device: opened.dev, inode: opened.ino };
          } catch {
            // Without an identity, leaving the entry is safer than unlinking it.
          }
          if (identity) await this.unlinkIfOwned(lockPath, identity);
          await handle.close().catch(() => undefined);
        }
        if (!isNodeError(error) || error.code !== 'EEXIST') throw error;

        if (await this.removeRecognizableStaleLock(lockPath)) continue;
        if (Date.now() >= deadline) {
          throw new EditorFileError(
            'changed',
            'Another Agents Commander editor is saving this file; try again',
          );
        }
        const remaining = Math.max(1, deadline - Date.now());
        await new Promise((resolve) => {
          setTimeout(resolve, Math.min(this.lockRetryMs, remaining));
        });
      }
    }
  }

  private async removeRecognizableStaleLock(lockPath: string): Promise<boolean> {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let handle: FileHandle | null = null;
    try {
      handle = await fs.open(lockPath, constants.O_RDONLY | noFollow);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > 2048) return false;
      const bytes = await handle.readFile();
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch {
        return false;
      }
      if (!isSaveLockRecord(parsed)) return false;
      const currentUserId = typeof process.getuid === 'function' ? process.getuid() : null;
      if (currentUserId !== null && opened.uid !== currentUserId) return false;
      if ((opened.mode & 0o777) !== 0o600 || opened.nlink !== 1) return false;
      if (parsed.hostname !== os.hostname()) return false;
      if (Math.abs(opened.mtimeMs - parsed.createdAt) > 5000) return false;
      if (Date.now() - parsed.createdAt < this.staleLockMs) return false;
      if (isProcessAlive(parsed.pid)) return false;

      return await this.unlinkIfOwned(lockPath, {
        device: opened.dev,
        inode: opened.ino,
      });
    } catch {
      // Symlinks, unreadable entries, and foreign lock formats are left intact.
      return false;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
  }

  private async releaseSaveLock(lock: OwnedFile): Promise<void> {
    try {
      await this.unlinkIfOwned(lock.path, lock.identity);
    } finally {
      await lock.handle.close().catch(() => undefined);
    }
  }

  private async createExclusiveTemp(
    filePath: string,
    mode: number,
  ): Promise<{ tempPath: string; handle: FileHandle; identity: FileIdentity }> {
    const directory = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;

    for (let attempt = 0; attempt < 8; attempt++) {
      const tempPath = path.join(
        directory,
        `.${baseName}.agents-commander-${process.pid}-${this.makeNonce()}.tmp`,
      );
      try {
        const handle = await fs.open(tempPath, flags, mode);
        try {
          const opened = await handle.stat();
          return {
            tempPath,
            handle,
            identity: { device: opened.dev, inode: opened.ino },
          };
        } catch (error) {
          await handle.close().catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') continue;
        throw error;
      }
    }

    throw new EditorFileError('io', 'Unable to create a unique temporary file');
  }

  private async assertOwnedTemp(tempPath: string, identity: FileIdentity): Promise<void> {
    await this.assertOwnedPath(
      tempPath,
      identity,
      'The temporary save file changed; save cancelled',
    );
  }

  private async assertOwnedPath(
    filePath: string,
    identity: FileIdentity,
    message: string,
  ): Promise<void> {
    let entry;
    try {
      entry = await fs.lstat(filePath);
    } catch (error) {
      throw new EditorFileError('changed', message, { cause: error });
    }
    if (entry.isSymbolicLink() || !entry.isFile() || !sameIdentity(entry, identity)) {
      throw new EditorFileError('changed', message);
    }
  }

  private async unlinkIfOwned(filePath: string, identity: FileIdentity): Promise<boolean> {
    try {
      const entry = await fs.lstat(filePath);
      if (!entry.isSymbolicLink() && entry.isFile() && sameIdentity(entry, identity)) {
        await fs.unlink(filePath);
        return true;
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        // A failed cleanup must not hide the original save result.
      }
    }
    return false;
  }

  private asLoadError(error: unknown): EditorFileError {
    if (error instanceof EditorFileError) return error;
    return new EditorFileError('io', 'Unable to open the file safely', { cause: error });
  }
}
