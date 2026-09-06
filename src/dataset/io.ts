import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const DATASET_FILE_LIMIT = 32 * 1024 * 1024;
export const DATASET_MAX_CANDIDATES = 2000;
export const DATASET_MAX_CAPTURES = 64;
export const DATASET_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const DATASET_MAX_SOURCE_EVENTS = 20_000;
const SAFE_NAME = /^[a-z][a-z0-9.-]{0,79}$/;

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonical(value: unknown, depth = 0): string {
  if (depth > 24) throw new Error('Dataset object nesting exceeds limit');
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function assertRecord(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`Unknown field in ${label}`);
}

/** Refuse user-controlled symlinks, allowing only macOS's fixed system aliases. */
export function checkedPath(input: string): string {
  if (!input || input.includes('\0')) throw new Error('Invalid dataset path');
  const absolute = path.resolve(input);
  let current = path.parse(absolute).root;
  const parts = absolute.slice(current.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const expected = current === '/tmp' ? '/private/tmp' : current === '/var' ? '/private/var' : null;
      if (!expected || fs.realpathSync(current) !== expected) throw new Error('Symlink paths are not allowed');
    }
  }
  return absolute;
}

export function privateDirectory(input: string): string {
  const directory = checkedPath(input);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0
    || (process.getuid && stat.uid !== process.getuid())) throw new Error('Dataset directory must be private and owned by the current user');
  return directory;
}

export function readPrivateFile(directory: string, name: string, limit = DATASET_FILE_LIMIT): Buffer {
  if (name !== '.gitignore' && !SAFE_NAME.test(name)) throw new Error('Unsafe dataset file name');
  privateDirectory(directory);
  const target = path.join(directory, name);
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o077) !== 0
    || (process.getuid && before.uid !== process.getuid()) || before.size > limit) {
    throw new Error(`Unsafe or oversized dataset file: ${name}`);
  }
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) throw new Error('Dataset file changed while opening');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const read = fs.readSync(fd, data, offset, data.length - offset, offset);
      if (!read) throw new Error('Dataset file changed while reading');
      offset += read;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Dataset file changed while reading');
    return data;
  } finally { fs.closeSync(fd); }
}

export function parseJson(data: Buffer, label: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { throw new Error(`Invalid JSON in ${label}`); }
}

export function parseJsonl(data: Buffer, label: string, limit = DATASET_MAX_CANDIDATES): unknown[] {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new Error(`Invalid UTF-8 in ${label}`); }
  if (text && !text.endsWith('\n')) throw new Error(`Incomplete JSONL file: ${label}`);
  const lines = text ? text.slice(0, -1).split('\n') : [];
  if (lines.length > limit) throw new Error(`Too many records in ${label}`);
  return lines.map((line) => parseJson(Buffer.from(line), label));
}

export function jsonl(values: readonly unknown[]): string {
  return values.length ? `${values.map((value) => canonical(value)).join('\n')}\n` : '';
}

export function writeNewDirectory(input: string, files: Record<string, string>): string {
  const directory = checkedPath(input);
  const parent = path.dirname(directory);
  if (!fs.statSync(parent).isDirectory()) throw new Error('Output parent must be an existing directory');
  for (const [name, data] of Object.entries(files)) {
    if ((name !== '.gitignore' && !SAFE_NAME.test(name)) || Buffer.byteLength(data) > DATASET_FILE_LIMIT) throw new Error('Invalid or oversized output file');
  }
  fs.mkdirSync(directory, { mode: 0o700 }); // Never reuse or overwrite an existing directory.
  const identity = fs.lstatSync(directory);
  try {
    for (const [name, data] of Object.entries(files)) {
      privateDirectory(directory);
      const now = fs.lstatSync(directory);
      if (now.ino !== identity.ino || now.dev !== identity.dev) throw new Error('Output directory changed');
      const fd = fs.openSync(path.join(directory, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  } catch (error) {
    throw new Error(`Dataset write failed; partial private directory retained at ${directory}: ${error instanceof Error ? error.message : 'write error'}`);
  }
  return directory;
}
