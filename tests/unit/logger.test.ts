import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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

  it('retries a rotation lock released between open and fstat', async () => {
    const { LOG_DIR, LOG_FILE, logger } = await importLogger(fixtureRoot);
    const lockPath = `${LOG_FILE}.lock`;
    await fs.mkdir(LOG_DIR, { mode: 0o700 });
    await fs.writeFile(lockPath, '', { mode: 0o600 });
    const originalOpen = fsSync.openSync;
    let releasedFd: number | null = null;
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(fsSync, 'openSync').mockImplementation((file, flags, mode) => {
      const fd = originalOpen(file, flags, mode);
      if (file === lockPath && typeof flags === 'number' && !(flags & fsSync.constants.O_EXCL)) {
        releasedFd = fd;
        fsSync.unlinkSync(lockPath);
        expect(fsSync.fstatSync(fd).nlink).toBe(0);
      }
      return fd;
    });
    const close = vi.spyOn(fsSync, 'closeSync');

    logger.info('survived concurrent lock release');
    logger.close();

    expect(releasedFd).not.toBeNull();
    expect(close).toHaveBeenCalledWith(releasedFd);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(await fs.readFile(LOG_FILE, 'utf8')).toContain('survived concurrent lock release');
    await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries a lock whose inode changes between lstat and open', async () => {
    const { LOG_DIR, LOG_FILE, logger } = await importLogger(fixtureRoot);
    const lockPath = `${LOG_FILE}.lock`;
    await fs.mkdir(LOG_DIR, { mode: 0o700 });
    await fs.writeFile(lockPath, '', { mode: 0o600 });
    const originalOpen = fsSync.openSync;
    let replaced = false;
    vi.spyOn(fsSync, 'openSync').mockImplementation((file, flags, mode) => {
      if (!replaced && file === lockPath && typeof flags === 'number' && !(flags & fsSync.constants.O_EXCL)) {
        replaced = true;
        const previousFd = originalOpen(file, flags, mode);
        try {
          fsSync.unlinkSync(lockPath);
          fsSync.writeFileSync(lockPath, '', { flag: 'wx', mode: 0o600 });
          const staleTime = new Date(Date.now() - 60_000);
          fsSync.utimesSync(lockPath, staleTime, staleTime);
          expect(fsSync.lstatSync(lockPath).ino).not.toBe(fsSync.fstatSync(previousFd).ino);
          return originalOpen(file, flags, mode);
        } finally {
          fsSync.closeSync(previousFd);
        }
      }
      return originalOpen(file, flags, mode);
    });
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info('survived replacement identity');
    logger.close();

    expect(replaced).toBe(true);
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(await fs.readFile(LOG_FILE, 'utf8')).toContain('survived replacement identity');
    await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a symlink substituted between lock validation and open', async () => {
    const { LOG_DIR, LOG_FILE, logger } = await importLogger(fixtureRoot);
    const lockPath = `${LOG_FILE}.lock`;
    const victimPath = path.join(fixtureRoot, 'victim.txt');
    await fs.mkdir(LOG_DIR, { mode: 0o700 });
    await fs.writeFile(lockPath, '', { mode: 0o600 });
    await fs.writeFile(victimPath, 'unchanged', { mode: 0o600 });
    const originalOpen = fsSync.openSync;
    let replaced = false;
    vi.spyOn(fsSync, 'openSync').mockImplementation((file, flags, mode) => {
      if (!replaced && file === lockPath && typeof flags === 'number' && !(flags & fsSync.constants.O_EXCL)) {
        replaced = true;
        fsSync.unlinkSync(lockPath);
        fsSync.symlinkSync(victimPath, lockPath);
      }
      return originalOpen(file, flags, mode);
    });
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info('must not follow a substituted lock');
    logger.close();

    expect(replaced).toBe(true);
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('File logging disabled');
    expect(await fs.readFile(victimPath, 'utf8')).toBe('unchanged');
    expect((await fs.lstat(lockPath)).isSymbolicLink()).toBe(true);
    await expect(fs.lstat(LOG_FILE)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['hard-link', 'foreign-owner', 'non-regular'] as const)(
    'does not retry an unsafe %s descriptor as a released lock',
    async (unsafeKind) => {
      const { LOG_DIR, LOG_FILE, logger } = await importLogger(fixtureRoot);
      const lockPath = `${LOG_FILE}.lock`;
      const linkedPath = path.join(fixtureRoot, 'linked-lock');
      await fs.mkdir(LOG_DIR, { mode: 0o700 });
      await fs.writeFile(lockPath, 'unchanged', { mode: 0o600 });
      const originalOpen = fsSync.openSync;
      const originalFstat = fsSync.fstatSync;
      let observedFd: number | null = null;
      vi.spyOn(fsSync, 'openSync').mockImplementation((file, flags, mode) => {
        const fd = originalOpen(file, flags, mode);
        if (file === lockPath && typeof flags === 'number' && !(flags & fsSync.constants.O_EXCL)) {
          observedFd = fd;
          if (unsafeKind === 'hard-link') fsSync.linkSync(lockPath, linkedPath);
          else fsSync.unlinkSync(lockPath);
        }
        return fd;
      });
      vi.spyOn(fsSync, 'fstatSync').mockImplementation((fd, options) => {
        const stat = originalFstat(fd, options);
        if (fd === observedFd) {
          if (unsafeKind === 'foreign-owner') stat.uid = Number(stat.uid) + 1;
          if (unsafeKind === 'non-regular') stat.isFile = () => false;
        }
        return stat;
      });
      const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      logger.info('must reject unsafe lock');
      logger.close();

      expect(observedFd).not.toBeNull();
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      const expectedError = {
        'hard-link': 'multiply-linked',
        'foreign-owner': 'not owned by the current user',
        'non-regular': 'non-regular',
      }[unsafeKind];
      expect(stderrWrite.mock.calls[0]?.[0]).toContain(expectedError);
      await expect(fs.lstat(LOG_FILE)).rejects.toMatchObject({ code: 'ENOENT' });
      if (unsafeKind === 'hard-link') {
        expect(await fs.readFile(linkedPath, 'utf8')).toBe('unchanged');
        expect(await fs.readFile(lockPath, 'utf8')).toBe('unchanged');
      }
    },
  );

  it('keeps the lock deadline bounded when each observed lock is replaced', async () => {
    const { LOG_DIR, LOG_FILE, logger } = await importLogger(fixtureRoot);
    const lockPath = `${LOG_FILE}.lock`;
    await fs.mkdir(LOG_DIR, { mode: 0o700 });
    await fs.writeFile(lockPath, '', { mode: 0o600 });
    const originalOpen = fsSync.openSync;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    let observedLocks = 0;
    vi.spyOn(fsSync, 'openSync').mockImplementation((file, flags, mode) => {
      if (file === lockPath && typeof flags === 'number' && !(flags & fsSync.constants.O_EXCL)) {
        observedLocks += 1;
        if (observedLocks > 2) throw new Error('fixture detected an unbounded lock retry');
        const fd = originalOpen(file, flags, mode);
        fsSync.unlinkSync(lockPath);
        fsSync.writeFileSync(lockPath, '', { flag: 'wx', mode: 0o600 });
        clock.mockReturnValue(1250);
        return fd;
      }
      return originalOpen(file, flags, mode);
    });
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info('must not retry forever');
    logger.close();

    expect(observedLocks).toBe(1);
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('Timed out waiting for the log rotation lock');
    await expect(fs.lstat(LOG_FILE)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(lockPath, 'utf8')).toBe('');
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
      let reportedContention = false;
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
      } else {
        const originalOpen = fs.openSync;
        fs.openSync = function(file, flags, mode) {
          try {
            return originalOpen(file, flags, mode);
          } catch (error) {
            if (file === lockPath && typeof flags === 'number'
              && (flags & fs.constants.O_EXCL) && error.code === 'EEXIST'
              && !reportedContention) {
              reportedContention = true;
              fs.writeFileSync(attemptPath, 'contended', { flag: 'wx', mode: 0o600 });
            }
            throw error;
          }
        };
      }
      process.stdout.write('ready\\n');
      await new Promise((resolve) => process.stdin.once('data', resolve));
      if (lockFd !== null) {
        const deadline = Date.now() + 2000;
        while (!fs.existsSync(attemptPath)) {
          if (Date.now() >= deadline) throw new Error('contender never attempted a flush');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        if (fs.existsSync(lockPath.slice(0, -5) + '.1')) {
          throw new Error('contender rotated without holding the lock');
        }
        fs.unlinkSync(lockPath);
        fs.closeSync(lockFd);
      }
      logger.info('worker-' + role + ' ' + 'x'.repeat(2048));
      logger.close();
      if (role === 'contender' && !reportedContention) {
        throw new Error('contender never observed the held lock');
      }
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
    const originalOpen = fsSync.openSync;
    let observedContention = false;
    vi.spyOn(fsSync, 'openSync').mockImplementation((file, flags, mode) => {
      try {
        return originalOpen(file, flags, mode);
      } catch (error) {
        if (file === lockPath && typeof flags === 'number'
          && (flags & fsSync.constants.O_EXCL)
          && (error as NodeJS.ErrnoException).code === 'EEXIST'
          && !observedContention) {
          observedContention = true;
          fsSync.writeFileSync(readerStartedPath, 'contended', { flag: 'wx', mode: 0o600 });
        }
        throw error;
      }
    });

    const tail = readLogTail();
    const [childCode] = await childExit;

    expect({ childCode, childError }).toEqual({ childCode: 0, childError: '' });
    expect(observedContention).toBe(true);
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
