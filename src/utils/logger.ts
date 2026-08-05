import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

export const LOG_DIR = path.join(os.homedir(), '.agents-commander');
export const LOG_FILE = path.join(LOG_DIR, 'debug.log');
export const ROTATED_LOG_FILE = `${LOG_FILE}.1`;
export const MAX_LOG_FILE_BYTES = 1024 * 1024;
export const MAX_LOG_ENTRY_BYTES = 16 * 1024;
export const MAX_LOG_VIEW_BYTES = 256 * 1024;
export const MAX_LOG_VIEW_LINES = 200;

const LOG_DIRECTORY_MODE = 0o700;
const LOG_FILE_MODE = 0o600;
const LOG_LOCK_FILE = `${LOG_FILE}.lock`;
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const NON_BLOCKING = fs.constants.O_NONBLOCK ?? 0;
const MAX_PENDING_LOG_BYTES = 256 * 1024;
const LOG_LOCK_TIMEOUT_MS = 250;
const LOG_LOCK_RETRY_MS = 5;
const STALE_INCOMPLETE_LOCK_MS = 30_000;
const MAX_LOG_LOCK_BYTES = 2048;

interface LogLockRecord {
  version: 1;
  pid: number;
  hostname: string;
  createdAt: number;
  token: string;
}

interface OwnedLogLock {
  fd: number;
  device: number;
  inode: number;
}

class LogPathChangedError extends Error {}

let logFd: number | null = null;
let logBytes = 0;
let pendingEntries: Buffer[] = [];
let pendingEntryBytes = 0;
let flushHandle: NodeJS.Immediate | null = null;
let flushing = false;
let fileLoggingDisabled = false;
let failureReported = false;

function timestamp(): string {
  return new Date().toISOString();
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isLogLockRecord(value: unknown): value is LogLockRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<LogLockRecord>;
  return record.version === 1
    && Number.isSafeInteger(record.pid)
    && (record.pid ?? 0) > 0
    && typeof record.hostname === 'string'
    && record.hostname.length > 0
    && record.hostname.length <= 255
    && Number.isSafeInteger(record.createdAt)
    && (record.createdAt ?? 0) > 0
    && typeof record.token === 'string'
    && /^[a-f0-9]{24}$/u.test(record.token);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error) || error.code !== 'ESRCH';
  }
}

function waitForLogLock(milliseconds: number): void {
  if (milliseconds <= 0) return;
  // Atomics.wait provides a bounded synchronous pause without burning a CPU
  // core. Logger flushes are synchronous so close() can guarantee durability.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertCurrentUserOwner(stat: fs.Stats, description: string): void {
  const getuid = process.getuid;
  if (typeof getuid === 'function' && stat.uid !== getuid()) {
    throw new Error(`${description} is not owned by the current user`);
  }
}

function assertSafeRegularFile(stat: fs.Stats, filePath: string): void {
  if (!stat.isFile()) throw new Error(`Refusing non-regular log file: ${filePath}`);
  assertCurrentUserOwner(stat, `Log file ${filePath}`);
  if (stat.nlink !== 1) {
    throw new Error(`Refusing multiply-linked log file: ${filePath}`);
  }
}

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: LOG_DIRECTORY_MODE });
  const stat = fs.lstatSync(LOG_DIR);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Log directory is not a regular directory');
  }
  assertCurrentUserOwner(stat, 'Log directory');
  fs.chmodSync(LOG_DIR, LOG_DIRECTORY_MODE);
}

function validatePrivateLogDirForRead(): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(LOG_DIR);
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Log directory is not a regular directory');
  }
  assertCurrentUserOwner(stat, 'Log directory');
  if ((stat.mode & 0o077) !== 0) {
    throw new Error('Log directory permissions are not private');
  }
  return true;
}

function validateExistingRegularFile(filePath: string): fs.Stats | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Refusing unsafe log path: ${filePath}`);
    }
    assertSafeRegularFile(stat, filePath);
    return stat;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function closeLogFd(): void {
  const fd = logFd;
  logFd = null;
  logBytes = 0;
  if (fd === null) return;
  try {
    fs.closeSync(fd);
  } catch {
    // The descriptor is already unusable; logging is best effort.
  }
}

function reportFailure(error: unknown): void {
  if (failureReported) return;
  failureReported = true;

  const message = error instanceof Error ? error.message : String(error);
  try {
    process.stderr.write(`[${timestamp()}] WARN: File logging disabled: ${message}\n`);
  } catch {
    // Ignore stderr failures.
  }
}

function disableFileLogging(error: unknown): void {
  fileLoggingDisabled = true;
  if (flushHandle) clearImmediate(flushHandle);
  flushHandle = null;
  pendingEntries = [];
  pendingEntryBytes = 0;
  closeLogFd();
  reportFailure(error);
}

function openRegularFileNoFollow(
  filePath: string,
  flags: number,
  mode: number,
): { fd: number; stat: fs.Stats } {
  const before = validateExistingRegularFile(filePath);
  const fd = fs.openSync(filePath, flags | NO_FOLLOW | NON_BLOCKING, mode);
  try {
    const stat = fs.fstatSync(fd);
    assertSafeRegularFile(stat, filePath);
    if (before && (before.dev !== stat.dev || before.ino !== stat.ino)) {
      throw new LogPathChangedError(`Log path changed while it was being opened: ${filePath}`);
    }
    return { fd, stat };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function unlinkRegularFileIfIdentity(
  filePath: string,
  device: number,
  inode: number,
): boolean {
  let current: fs.Stats;
  try {
    current = fs.lstatSync(filePath);
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
  if (current.isSymbolicLink()) return false;
  assertSafeRegularFile(current, filePath);
  if (current.dev !== device || current.ino !== inode) return false;
  fs.unlinkSync(filePath);
  return true;
}

function tryRemoveAbandonedLogLock(): boolean {
  let opened: { fd: number; stat: fs.Stats };
  try {
    opened = openRegularFileNoFollow(
      LOG_LOCK_FILE,
      fs.constants.O_RDONLY,
      LOG_FILE_MODE,
    );
  } catch (error) {
    if (isMissingFileError(error)) return true;
    // The previous owner may have released the lock and a waiter may have
    // replaced it between lstat and open. That is normal contention: retry the
    // exclusive acquisition instead of disabling logging.
    if (error instanceof LogPathChangedError) return true;
    throw error;
  }

  try {
    const now = Date.now();
    const ageFromMtime = now - opened.stat.mtimeMs;
    const hasPrivateMode = (opened.stat.mode & 0o777) === LOG_FILE_MODE;
    let record: unknown = null;
    if (opened.stat.size <= MAX_LOG_LOCK_BYTES) {
      try {
        record = JSON.parse(fs.readFileSync(opened.fd, 'utf8'));
      } catch {
        // A process can exit between exclusive creation and writing its record.
      }
    }

    let abandoned = false;
    if (hasPrivateMode && isLogLockRecord(record)) {
      const timestampMatches = Math.abs(opened.stat.mtimeMs - record.createdAt) <= 5000;
      abandoned = timestampMatches
        && record.hostname === os.hostname()
        && !isProcessAlive(record.pid);
    } else if (hasPrivateMode && ageFromMtime >= STALE_INCOMPLETE_LOCK_MS) {
      // Recover an incomplete record only after a conservative grace period.
      // Symlinks, hard links, foreign owners, and broad permissions were
      // already rejected above and are never removed here.
      abandoned = true;
    }

    return abandoned && unlinkRegularFileIfIdentity(
      LOG_LOCK_FILE,
      opened.stat.dev,
      opened.stat.ino,
    );
  } finally {
    fs.closeSync(opened.fd);
  }
}

function acquireLogLock(): OwnedLogLock {
  ensureLogDir();
  const deadline = Date.now() + LOG_LOCK_TIMEOUT_MS;
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | NO_FOLLOW
    | NON_BLOCKING;

  while (true) {
    let fd: number | null = null;
    let identity: { device: number; inode: number } | null = null;
    try {
      fd = fs.openSync(LOG_LOCK_FILE, flags, LOG_FILE_MODE);
      const initial = fs.fstatSync(fd);
      assertSafeRegularFile(initial, LOG_LOCK_FILE);
      identity = { device: initial.dev, inode: initial.ino };
      fs.fchmodSync(fd, LOG_FILE_MODE);

      const record: LogLockRecord = {
        version: 1,
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: Date.now(),
        token: randomBytes(12).toString('hex'),
      };
      fs.writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
      fs.fsyncSync(fd);

      const current = validateExistingRegularFile(LOG_LOCK_FILE);
      if (
        !current
        || current.dev !== identity.device
        || current.ino !== identity.inode
        || (current.mode & 0o777) !== LOG_FILE_MODE
      ) {
        throw new Error('Log rotation lock changed while it was being acquired');
      }
      return { fd, ...identity };
    } catch (error) {
      if (fd !== null) {
        if (identity) {
          try {
            unlinkRegularFileIfIdentity(LOG_LOCK_FILE, identity.device, identity.inode);
          } catch {
            // Never unlink a path whose ownership can no longer be proven.
          }
        }
        try {
          fs.closeSync(fd);
        } catch {
          // The failed acquisition is already being reported by the caller.
        }
      }

      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      if (tryRemoveAbandonedLogLock()) continue;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('Timed out waiting for the log rotation lock');
      }
      waitForLogLock(Math.min(LOG_LOCK_RETRY_MS, remaining));
    }
  }
}

function releaseLogLock(lock: OwnedLogLock): void {
  try {
    if (!unlinkRegularFileIfIdentity(LOG_LOCK_FILE, lock.device, lock.inode)) {
      throw new Error('Log rotation lock changed before release');
    }
  } finally {
    fs.closeSync(lock.fd);
  }
}

function withLogLock<T>(action: () => T): T {
  const lock = acquireLogLock();
  try {
    return action();
  } finally {
    releaseLogLock(lock);
  }
}

function capRotatedLog(): void {
  const opened = openRegularFileNoFollow(
    ROTATED_LOG_FILE,
    fs.constants.O_WRONLY,
    LOG_FILE_MODE,
  );
  try {
    if (opened.stat.size > MAX_LOG_FILE_BYTES) {
      fs.ftruncateSync(opened.fd, MAX_LOG_FILE_BYTES);
    }
    fs.fchmodSync(opened.fd, LOG_FILE_MODE);
  } finally {
    fs.closeSync(opened.fd);
  }
}

function rotateLog(): void {
  if (logFd !== null) {
    const descriptorStat = fs.fstatSync(logFd);
    assertSafeRegularFile(descriptorStat, LOG_FILE);
    const currentPathStat = validateExistingRegularFile(LOG_FILE);
    if (
      !currentPathStat
      || currentPathStat.dev !== descriptorStat.dev
      || currentPathStat.ino !== descriptorStat.ino
    ) {
      throw new Error('Log path changed before rotation');
    }
  }
  closeLogFd();
  const current = validateExistingRegularFile(LOG_FILE);
  if (!current) return;

  const rotated = validateExistingRegularFile(ROTATED_LOG_FILE);
  if (rotated) {
    fs.unlinkSync(ROTATED_LOG_FILE);
  }

  fs.renameSync(LOG_FILE, ROTATED_LOG_FILE);
  fs.chmodSync(ROTATED_LOG_FILE, LOG_FILE_MODE);
  capRotatedLog();
}

function openLogFile(): void {
  ensureLogDir();
  const opened = openRegularFileNoFollow(
    LOG_FILE,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT,
    LOG_FILE_MODE,
  );
  try {
    fs.fchmodSync(opened.fd, LOG_FILE_MODE);
  } catch (error) {
    fs.closeSync(opened.fd);
    throw error;
  }
  logFd = opened.fd;
  logBytes = opened.stat.size;
}

/**
 * Reconcile this process's cached descriptor with the pathname while holding
 * the inter-process lock. Another Agents Commander process may have rotated
 * the file since our previous flush, leaving our descriptor on debug.log.1 or
 * on an unlinked inode.
 */
function synchronizeLogFileUnderLock(): void {
  if (logFd !== null) {
    const descriptorStat = fs.fstatSync(logFd);
    if (!descriptorStat.isFile()) {
      throw new Error(`Refusing non-regular log file: ${LOG_FILE}`);
    }
    assertCurrentUserOwner(descriptorStat, `Log file ${LOG_FILE}`);
    const currentPathStat = validateExistingRegularFile(LOG_FILE);
    if (
      !currentPathStat
      || currentPathStat.dev !== descriptorStat.dev
      || currentPathStat.ino !== descriptorStat.ino
    ) {
      closeLogFd();
    } else {
      assertSafeRegularFile(descriptorStat, LOG_FILE);
      logBytes = descriptorStat.size;
    }
  }
  if (logFd === null) openLogFile();
}

function truncateUtf8(value: string, maxBytes: number, suffix = '...[truncated]'): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;

  const suffixBytes = Buffer.from(suffix, 'utf8');
  const available = Math.max(0, maxBytes - suffixBytes.length);
  let end = available;
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString('utf8') + suffix;
}

function escapeLogControls(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) => {
    switch (character) {
      case '\t': return '\\t';
      case '\n': return '\\n';
      case '\r': return '\\r';
      default: return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
}

function formatArgument(value: unknown): string {
  if (value instanceof Error) {
    return truncateUtf8(escapeLogControls(`${value.message}\n${value.stack ?? ''}`), 4096);
  }
  if (typeof value === 'string') return truncateUtf8(escapeLogControls(value), 4096);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value !== 'object' || value === null) return escapeLogControls(String(value));

  const seen = new WeakSet<object>();
  let visited = 0;
  try {
    const serialized = JSON.stringify(value, (_key, nested) => {
      visited += 1;
      if (visited > 64) return '[truncated]';
      if (typeof nested === 'string') return truncateUtf8(nested, 1024);
      if (typeof nested === 'bigint') return `${nested.toString()}n`;
      if (typeof nested === 'object' && nested !== null) {
        if (seen.has(nested)) return '[circular]';
        seen.add(nested);
      }
      return nested;
    });
    return truncateUtf8(escapeLogControls(serialized ?? String(value)), 4096);
  } catch {
    return truncateUtf8(escapeLogControls(String(value)), 4096);
  }
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  const rendered = args.slice(0, 8).map(formatArgument);
  if (args.length > rendered.length) {
    rendered.push(`[${args.length - rendered.length} argument(s) omitted]`);
  }
  return ` ${rendered.join(' ')}`;
}

function writeBuffer(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(fd, buffer, offset, buffer.length - offset);
    if (written <= 0) throw new Error('Unable to append to log file');
    offset += written;
  }
}

function scheduleLogFlush(): void {
  if (flushHandle || fileLoggingDisabled) return;
  flushHandle = setImmediate(() => {
    flushHandle = null;
    flushPendingLogs();
  });
}

function flushPendingLogs(): void {
  if (flushing || fileLoggingDisabled || pendingEntries.length === 0) return;
  flushing = true;
  const entries = pendingEntries;
  pendingEntries = [];
  pendingEntryBytes = 0;

  try {
    withLogLock(() => {
      synchronizeLogFileUnderLock();
      let index = 0;
      while (index < entries.length) {
        if (logFd === null) throw new Error('Unable to open log file');

        const first = entries[index];
        if (logBytes > 0 && logBytes + first.length > MAX_LOG_FILE_BYTES) {
          rotateLog();
          openLogFile();
        }
        if (logFd === null) throw new Error('Unable to reopen log file after rotation');

        const batch: Buffer[] = [];
        let batchBytes = 0;
        while (
          index < entries.length
          && logBytes + batchBytes + entries[index].length <= MAX_LOG_FILE_BYTES
        ) {
          batch.push(entries[index]);
          batchBytes += entries[index].length;
          index += 1;
        }
        if (batch.length === 0) {
          // Entries are capped well below MAX_LOG_FILE_BYTES, so this can only
          // happen for an oversized legacy file that needs rotating first.
          rotateLog();
          continue;
        }
        writeBuffer(logFd, batch.length === 1 ? batch[0] : Buffer.concat(batch, batchBytes));
        logBytes += batchBytes;
      }
    });
  } catch (error) {
    disableFileLogging(error);
  } finally {
    flushing = false;
    if (pendingEntries.length > 0) scheduleLogFlush();
  }
}

function writeLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, args: unknown[]): void {
  const safeMessage = truncateUtf8(escapeLogControls(message), 8192);
  const rawEntry = `[${timestamp()}] ${level}: ${safeMessage}${formatArgs(args)}\n`;
  const entry = truncateUtf8(rawEntry, MAX_LOG_ENTRY_BYTES - 1, '...[entry truncated]\n');
  const buffer = Buffer.from(entry, 'utf8');
  if (fileLoggingDisabled) return;
  pendingEntries.push(buffer);
  pendingEntryBytes += buffer.length;
  if (pendingEntryBytes >= MAX_PENDING_LOG_BYTES) flushPendingLogs();
  else scheduleLogFlush();
}

/** Read only the bounded tail used by the in-app log viewer. */
export function readLogTail(
  maxBytes = MAX_LOG_VIEW_BYTES,
  maxLines = MAX_LOG_VIEW_LINES,
): string | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_LOG_VIEW_BYTES) {
    throw new RangeError(`Log tail byte limit must be between 1 and ${MAX_LOG_VIEW_BYTES}`);
  }
  if (!Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > MAX_LOG_VIEW_LINES) {
    throw new RangeError(`Log tail line limit must be between 1 and ${MAX_LOG_VIEW_LINES}`);
  }
  flushPendingLogs();
  // Preserve the no-log fast path without creating the log directory solely
  // to read it. Once a private directory exists, take the same inter-process
  // lock used by append/rotation so the pathname identity cannot legitimately
  // change between validation and open.
  if (!validatePrivateLogDirForRead()) return null;

  return withLogLock(() => {
    if (!validatePrivateLogDirForRead()) return null;

    let opened: { fd: number; stat: fs.Stats };
    try {
      opened = openRegularFileNoFollow(LOG_FILE, fs.constants.O_RDONLY, LOG_FILE_MODE);
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }

    try {
      const length = Math.min(opened.stat.size, maxBytes);
      if (length === 0) return '';
      const buffer = Buffer.allocUnsafe(length);
      const offset = Math.max(0, opened.stat.size - length);
      const bytesRead = fs.readSync(opened.fd, buffer, 0, length, offset);
      let content = buffer.subarray(0, bytesRead).toString('utf8');
      if (offset > 0) {
        const firstNewline = content.indexOf('\n');
        content = firstNewline >= 0 ? content.slice(firstNewline + 1) : '';
      }
      return content.split('\n').slice(-maxLines).join('\n');
    } finally {
      fs.closeSync(opened.fd);
    }
  });
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    writeLog('INFO', message, args);
  },
  warn(message: string, ...args: unknown[]): void {
    writeLog('WARN', message, args);
  },
  error(message: string, ...args: unknown[]): void {
    writeLog('ERROR', message, args);
  },
  debug(message: string, ...args: unknown[]): void {
    writeLog('DEBUG', message, args);
  },
  close(): void {
    if (flushHandle) clearImmediate(flushHandle);
    flushHandle = null;
    flushPendingLogs();
    closeLogFd();
    pendingEntries = [];
    pendingEntryBytes = 0;
    flushing = false;
    fileLoggingDisabled = false;
    failureReported = false;
  },
};
