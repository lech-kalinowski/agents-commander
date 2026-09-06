import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LoggerModule = typeof import('../../src/utils/logger.js');

let fixtureRoot = '';
let activeLogger: LoggerModule['logger'] | null = null;

async function importLogger(homeDirectory: string): Promise<LoggerModule> {
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    const mocked = { ...actual, homedir: () => homeDirectory };
    return { ...mocked, default: mocked };
  });
  const module = await import('../../src/utils/logger.js');
  activeLogger = module.logger;
  return module;
}

describe('logger', () => {
  beforeEach(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-logger-'));
  });

  afterEach(async () => {
    activeLogger?.close();
    activeLogger = null;
    vi.doUnmock('node:os');
    vi.restoreAllMocks();
    vi.resetModules();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  it('creates a private directory and a regular private log file', async () => {
    const { LOG_DIR, LOG_FILE, logger } = await importLogger(fixtureRoot);

    logger.info('private log entry');
    logger.close();

    const directory = await fs.lstat(LOG_DIR);
    const file = await fs.lstat(LOG_FILE);
    expect(directory.isDirectory()).toBe(true);
    expect(directory.isSymbolicLink()).toBe(false);
    expect(directory.mode & 0o777).toBe(0o700);
    expect(file.isFile()).toBe(true);
    expect(file.isSymbolicLink()).toBe(false);
    expect(file.mode & 0o777).toBe(0o600);
    expect(await fs.readFile(LOG_FILE, 'utf8')).toContain('private log entry');
  });

  it('tightens legacy directory and file permissions before appending', async () => {
    const logDirectory = path.join(fixtureRoot, '.agents-commander');
    const logPath = path.join(logDirectory, 'debug.log');
    await fs.mkdir(logDirectory, { mode: 0o755 });
    await fs.chmod(logDirectory, 0o755);
    await fs.writeFile(logPath, 'legacy\n', { mode: 0o644 });
    await fs.chmod(logPath, 0o644);
    const { logger } = await importLogger(fixtureRoot);

    logger.info('hardened');
    logger.close();

    expect((await fs.stat(logDirectory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(logPath)).mode & 0o777).toBe(0o600);
  });

  it('escapes line breaks and C0 controls so one call cannot forge log records', async () => {
    const { LOG_FILE, logger } = await importLogger(fixtureRoot);

    logger.error(
      'first line\n[2099-01-01T00:00:00.000Z] INFO: forged\r\t\u001b\u009b',
      new Error('argument\nforged\u0000\u0085'),
    );
    logger.close();

    const content = await fs.readFile(LOG_FILE, 'utf8');
    expect(content.trimEnd().split('\n')).toHaveLength(1);
    expect(content).toContain('first line\\n[2099');
    expect(content).toContain('\\r\\t\\u001b\\u009b');
    expect(content).toContain('argument\\nforged\\u0000\\u0085');
    expect(content.replace(/\n$/u, '')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
  });

  it('refuses a symlink log target without modifying its destination', async () => {
    const logDirectory = path.join(fixtureRoot, '.agents-commander');
    const logPath = path.join(logDirectory, 'debug.log');
    const victimPath = path.join(fixtureRoot, 'victim.txt');
    await fs.mkdir(logDirectory, { mode: 0o700 });
    await fs.writeFile(victimPath, 'unchanged', { mode: 0o600 });
    await fs.symlink(victimPath, logPath);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { logger } = await importLogger(fixtureRoot);

    expect(() => logger.error('must not follow the link')).not.toThrow();
    expect(() => logger.info('file logging remains disabled')).not.toThrow();

    expect(await fs.readFile(victimPath, 'utf8')).toBe('unchanged');
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('File logging disabled');
  });

  it('refuses a hard-linked log target without modifying the other pathname', async () => {
    const logDirectory = path.join(fixtureRoot, '.agents-commander');
    const logPath = path.join(logDirectory, 'debug.log');
    const victimPath = path.join(fixtureRoot, 'victim.txt');
    await fs.mkdir(logDirectory, { mode: 0o700 });
    await fs.writeFile(victimPath, 'unchanged', { mode: 0o600 });
    await fs.link(victimPath, logPath);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { logger } = await importLogger(fixtureRoot);

    expect(() => logger.error('must not follow the hard link')).not.toThrow();
    logger.close();

    expect(await fs.readFile(victimPath, 'utf8')).toBe('unchanged');
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('multiply-linked');
  });

  it('refuses a symlink rotation lock without modifying its destination', async () => {
    const logDirectory = path.join(fixtureRoot, '.agents-commander');
    const logPath = path.join(logDirectory, 'debug.log');
    const lockPath = `${logPath}.lock`;
    const victimPath = path.join(fixtureRoot, 'victim.txt');
    await fs.mkdir(logDirectory, { mode: 0o700 });
    await fs.writeFile(victimPath, 'unchanged', { mode: 0o600 });
    await fs.symlink(victimPath, lockPath);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { logger } = await importLogger(fixtureRoot);

    expect(() => logger.error('must not follow the lock link')).not.toThrow();
    logger.close();

    expect(await fs.readFile(victimPath, 'utf8')).toBe('unchanged');
    await expect(fs.lstat(logPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('unsafe log path');
  });

  it('recovers an aged incomplete private rotation lock', async () => {
    const logDirectory = path.join(fixtureRoot, '.agents-commander');
    const logPath = path.join(logDirectory, 'debug.log');
    const lockPath = `${logPath}.lock`;
    await fs.mkdir(logDirectory, { mode: 0o700 });
    await fs.writeFile(lockPath, '', { mode: 0o600 });
    const staleTime = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, staleTime, staleTime);
    const { logger } = await importLogger(fixtureRoot);

    logger.info('recovered after incomplete lock');
    logger.close();

    expect(await fs.readFile(logPath, 'utf8')).toContain('recovered after incomplete lock');
    await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a valid rotation lock left by an exited Node process', async () => {
    const logDirectory = path.join(fixtureRoot, '.agents-commander');
    const logPath = path.join(logDirectory, 'debug.log');
    const lockPath = `${logPath}.lock`;
    const child = spawn(process.execPath, [
      '-e',
      `
        const fs = require('node:fs');
        const os = require('node:os');
        const path = require('node:path');
        const lockPath = process.argv[1];
        fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
        const fd = fs.openSync(lockPath, 'wx', 0o600);
        fs.fchmodSync(fd, 0o600);
        fs.writeFileSync(fd, JSON.stringify({
          version: 1,
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: Date.now(),
          token: 'abcdef0123456789abcdef01',
        }) + '\\n');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
      `,
      lockPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let childError = '';
    child.stderr.on('data', (chunk) => { childError += chunk.toString(); });
    const [childCode] = await once(child, 'exit');
    expect({ childCode, childError }).toEqual({ childCode: 0, childError: '' });
    const { logger } = await importLogger(fixtureRoot);

    logger.info('recovered after exited owner');
    logger.close();

    expect(await fs.readFile(logPath, 'utf8')).toContain('recovered after exited owner');
    await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not throw when the private log directory cannot be created', async () => {
    await fs.writeFile(path.join(fixtureRoot, '.agents-commander'), 'path collision');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { logger } = await importLogger(fixtureRoot);

    expect(() => logger.error('directory creation failed')).not.toThrow();
    expect(() => logger.error('second failure is suppressed')).not.toThrow();
    logger.close();
    expect(stderrWrite).toHaveBeenCalledTimes(1);
  });

  it('rotates and caps both current and previous logs', async () => {
    const {
      LOG_FILE,
      MAX_LOG_ENTRY_BYTES,
      MAX_LOG_FILE_BYTES,
      ROTATED_LOG_FILE,
      logger,
    } = await importLogger(fixtureRoot);
    const payload = 'x'.repeat(MAX_LOG_ENTRY_BYTES * 2);
    const writes = Math.ceil(MAX_LOG_FILE_BYTES / 8192) + 8;

    for (let index = 0; index < writes; index += 1) {
      logger.info(`entry-${index} ${payload}`);
    }
    logger.close();

    const current = await fs.stat(LOG_FILE);
    const rotated = await fs.stat(ROTATED_LOG_FILE);
    expect(current.size).toBeLessThanOrEqual(MAX_LOG_FILE_BYTES);
    expect(rotated.size).toBeLessThanOrEqual(MAX_LOG_FILE_BYTES);
    expect(current.mode & 0o777).toBe(0o600);
    expect(rotated.mode & 0o777).toBe(0o600);
  });

  it('serializes competing rotations across two Node processes', async () => {
    const {
      LOG_DIR,
      LOG_FILE,
      MAX_LOG_FILE_BYTES,
      ROTATED_LOG_FILE,
    } = await importLogger(fixtureRoot);
    const source = await fs.readFile(
      new URL('../../src/utils/logger.ts', import.meta.url),
      'utf8',
    );
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        esModuleInterop: true,
      },
      fileName: 'logger.ts',
    }).outputText;
    const compiledPath = path.join(fixtureRoot, 'logger-under-test.mjs');
    await fs.writeFile(compiledPath, compiled, { mode: 0o600 });
    await fs.mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      LOG_FILE,
      Buffer.alloc(MAX_LOG_FILE_BYTES - 512, 0x73),
      { mode: 0o600 },
    );

    const lockPath = `${LOG_FILE}.lock`;
    const childSource = `
      import fs from 'node:fs';
      import os from 'node:os';
      import path from 'node:path';

      const [loggerUrl, role, lockPath, attemptPath] = process.argv.slice(1);
      const { logger } = await import(loggerUrl);
      let lockFd = null;
      if (role === 'holder') {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
        lockFd = fs.openSync(lockPath, 'wx', 0o600);
        fs.fchmodSync(lockFd, 0o600);
        const record = {
          version: 1,
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: Date.now(),
          token: '0123456789abcdef01234567',
        };
        fs.writeFileSync(lockFd, JSON.stringify(record) + '\\n', 'utf8');
        fs.fsyncSync(lockFd);
      }
      process.stdout.write('ready\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      if (lockFd !== null) {
        const deadline = Date.now() + 2000;
        while (!fs.existsSync(attemptPath)) {
          if (Date.now() >= deadline) throw new Error('contender never attempted a flush');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (fs.existsSync(lockPath.slice(0, -5) + '.1')) {
          throw new Error('contender rotated without holding the lock');
        }
        fs.unlinkSync(lockPath);
        fs.closeSync(lockFd);
      } else {
        fs.writeFileSync(attemptPath, 'attempting', { flag: 'wx', mode: 0o600 });
      }
      logger.info('worker-' + role + ' ' + 'x'.repeat(2048));
      logger.close();
    `;
    const childEnvironment = {
      ...process.env,
      HOME: fixtureRoot,
      USERPROFILE: fixtureRoot,
    };
    const loggerUrl = pathToFileURL(compiledPath).href;
    const attemptPath = path.join(fixtureRoot, 'contender-attempted');
    const holder = spawn(
      process.execPath,
      [
        '--input-type=module', '-e', childSource,
        loggerUrl, 'holder', lockPath, attemptPath,
      ],
      { env: childEnvironment, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const contender = spawn(
      process.execPath,
      [
        '--input-type=module', '-e', childSource,
        loggerUrl, 'contender', lockPath, attemptPath,
      ],
      { env: childEnvironment, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let holderError = '';
    let contenderError = '';
    holder.stderr.on('data', (chunk) => { holderError += chunk.toString(); });
    contender.stderr.on('data', (chunk) => { contenderError += chunk.toString(); });
    const holderExit = once(holder, 'exit');
    const contenderExit = once(contender, 'exit');

    await Promise.all([once(holder.stdout, 'data'), once(contender.stdout, 'data')]);
    holder.stdin.end('go\n');
    contender.stdin.end('go\n');
    const [[holderCode], [contenderCode]] = await Promise.all([holderExit, contenderExit]);

    expect({ holderCode, holderError }).toEqual({ holderCode: 0, holderError: '' });
    expect({ contenderCode, contenderError }).toEqual({ contenderCode: 0, contenderError: '' });
    const currentContent = await fs.readFile(LOG_FILE, 'utf8');
    expect(currentContent).toContain('worker-holder');
    expect(currentContent).toContain('worker-contender');
    expect((await fs.stat(LOG_FILE)).size).toBeLessThanOrEqual(MAX_LOG_FILE_BYTES);
    expect((await fs.stat(ROTATED_LOG_FILE)).size).toBeLessThanOrEqual(MAX_LOG_FILE_BYTES);
    expect((await fs.stat(LOG_FILE)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(ROTATED_LOG_FILE)).mode & 0o777).toBe(0o600);
    await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads only a bounded regular-file tail for the log viewer', async () => {
    const {
      LOG_DIR,
      LOG_FILE,
      MAX_LOG_VIEW_BYTES,
      MAX_LOG_VIEW_LINES,
      readLogTail,
    } = await importLogger(fixtureRoot);
    await fs.mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      LOG_FILE,
      `BEGIN_SHOULD_NOT_APPEAR\n${'x'.repeat(MAX_LOG_VIEW_BYTES + 1024)}\nTAIL\n`,
      { mode: 0o600 },
    );

    const tail = readLogTail();

    expect(tail).not.toBeNull();
    expect(tail).toContain('TAIL');
    expect(tail).not.toContain('BEGIN_SHOULD_NOT_APPEAR');
    expect(Buffer.byteLength(tail ?? '', 'utf8')).toBeLessThanOrEqual(MAX_LOG_VIEW_BYTES);
    expect((tail ?? '').split('\n').length).toBeLessThanOrEqual(MAX_LOG_VIEW_LINES);
  });

  it('reads the replacement identity after a concurrent process rotates', async () => {
    const {
      LOG_DIR,
      LOG_FILE,
      ROTATED_LOG_FILE,
      readLogTail,
    } = await importLogger(fixtureRoot);
    await fs.mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(LOG_FILE, 'BEFORE_ROTATION\n', { mode: 0o600 });
    const lockPath = `${LOG_FILE}.lock`;
    const readerStartedPath = path.join(fixtureRoot, 'reader-started');
    const childSource = `
      const fs = require('node:fs');
      const os = require('node:os');

      const [lockPath, logPath, readerStartedPath] = process.argv.slice(1);
      const lockFd = fs.openSync(lockPath, 'wx', 0o600);
      fs.fchmodSync(lockFd, 0o600);
      fs.writeFileSync(lockFd, JSON.stringify({
        version: 1,
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: Date.now(),
        token: '1234567890abcdef12345678',
      }) + '\\n');
      fs.fsyncSync(lockFd);
      process.stdout.write('ready\\n');

      const rotate = async () => {
        const deadline = Date.now() + 2000;
        while (!fs.existsSync(readerStartedPath)) {
          if (Date.now() >= deadline) throw new Error('reader never started');
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
        fs.renameSync(logPath, logPath + '.1');
        fs.writeFileSync(logPath, 'AFTER_ROTATION\\n', { mode: 0o600 });
        fs.chmodSync(logPath, 0o600);
        fs.unlinkSync(lockPath);
        fs.closeSync(lockFd);
      };
      rotate().catch((error) => {
        process.stderr.write(String(error?.stack ?? error) + '\\n');
        process.exitCode = 1;
      });
    `;
    const child = spawn(process.execPath, [
      '-e', childSource, lockPath, LOG_FILE, readerStartedPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let childError = '';
    child.stderr.on('data', (chunk) => { childError += chunk.toString(); });
    const childExit = once(child, 'exit');
    await once(child.stdout, 'data');
    await fs.writeFile(readerStartedPath, 'go', { mode: 0o600 });

    const tail = readLogTail();
    const [childCode] = await childExit;

    expect({ childCode, childError }).toEqual({ childCode: 0, childError: '' });
    expect(tail).toContain('AFTER_ROTATION');
    expect(tail).not.toContain('BEFORE_ROTATION');
    expect(await fs.readFile(ROTATED_LOG_FILE, 'utf8')).toBe('BEFORE_ROTATION\n');
  });

  it('refuses to read a symlink through the log viewer', async () => {
    const logDirectory = path.join(fixtureRoot, '.agents-commander');
    const logPath = path.join(logDirectory, 'debug.log');
    const victimPath = path.join(fixtureRoot, 'victim.txt');
    await fs.mkdir(logDirectory, { mode: 0o700 });
    await fs.writeFile(victimPath, 'private payload', { mode: 0o600 });
    await fs.symlink(victimPath, logPath);
    const { readLogTail } = await importLogger(fixtureRoot);

    expect(() => readLogTail()).toThrow(/unsafe log path/u);
  });

  it('refuses to traverse a symlink log directory in the viewer', async () => {
    const externalDirectory = path.join(fixtureRoot, 'external-logs');
    await fs.mkdir(externalDirectory, { mode: 0o700 });
    await fs.writeFile(path.join(externalDirectory, 'debug.log'), 'private payload', { mode: 0o600 });
    await fs.symlink(externalDirectory, path.join(fixtureRoot, '.agents-commander'));
    const { readLogTail } = await importLogger(fixtureRoot);

    expect(() => readLogTail()).toThrow(/not a regular directory/u);
  });
});
