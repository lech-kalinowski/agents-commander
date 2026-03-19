import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOG_DIR = path.join(os.homedir(), '.agents-commander');
const LOG_FILE = path.join(LOG_DIR, 'debug.log');

let logStream: fs.WriteStream | null = null;
let fileLoggingDisabled = false;
let failureReported = false;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function handleStreamError(err: Error): void {
  disableFileLogging(err);
}

function reportFailure(err: unknown): void {
  if (failureReported) return;
  failureReported = true;

  const message = err instanceof Error ? err.message : String(err);
  try {
    process.stderr.write(`[${timestamp()}] WARN: File logging disabled: ${message}\n`);
  } catch {
    // Ignore stderr failures.
  }
}

function detachStream(): fs.WriteStream | null {
  const stream = logStream;
  if (!stream) return null;

  stream.removeListener('error', handleStreamError);
  logStream = null;
  return stream;
}

function disableFileLogging(err: unknown): void {
  fileLoggingDisabled = true;
  const stream = detachStream();
  if (stream && !stream.destroyed) {
    stream.destroy();
  }
  reportFailure(err);
}

function getStream(): fs.WriteStream | null {
  if (fileLoggingDisabled) {
    return null;
  }

  if (!logStream) {
    try {
      ensureLogDir();
      logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
      logStream.on('error', handleStreamError);
    } catch (err) {
      disableFileLogging(err);
      return null;
    }
  }

  return logStream;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  return ' ' + args.map((a) => {
    if (a instanceof Error) {
      return `${a.message}\n${a.stack ?? ''}`;
    }
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
}

function writeLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', msg: string, args: unknown[]): void {
  const stream = getStream();
  if (!stream) return;

  try {
    stream.write(`[${timestamp()}] ${level}: ${msg}${formatArgs(args)}\n`);
  } catch (err) {
    disableFileLogging(err);
  }
}

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    writeLog('INFO', msg, args);
  },
  warn(msg: string, ...args: unknown[]): void {
    writeLog('WARN', msg, args);
  },
  error(msg: string, ...args: unknown[]): void {
    writeLog('ERROR', msg, args);
  },
  debug(msg: string, ...args: unknown[]): void {
    writeLog('DEBUG', msg, args);
  },
  close(): void {
    const stream = detachStream();
    stream?.end();
    fileLoggingDisabled = false;
    failureReported = false;
  },
};
