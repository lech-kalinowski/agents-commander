import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyFile,
  copyFiles,
  createDirectory,
  deleteFile,
  FileConflictError,
  FileOperationError,
  InvalidEntryNameError,
  moveFile,
  moveFiles,
  validateEntryName,
} from '../../src/file-manager/file-operations.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    chmod: vi.fn(),
    cp: vi.fn(),
    copyFile: vi.fn(),
    link: vi.fn(),
    lstat: vi.fn(),
    mkdtemp: vi.fn(),
    mkdir: vi.fn(),
    readlink: vi.fn(),
    rename: vi.fn(),
    rmdir: vi.fn(),
    rm: vi.fn(),
    stat: vi.fn(),
    symlink: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
  },
}));

type MockStat = Awaited<ReturnType<typeof fs.lstat>>;

const fileStat = {
  dev: 1,
  ino: 1,
  mode: 0o100644,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
} as MockStat;

const directoryStat = {
  dev: 1,
  ino: 2,
  mode: 0o40750,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
} as MockStat;

const symlinkStat = {
  dev: 1,
  ino: 3,
  mode: 0o120777,
  isDirectory: () => false,
  isFile: () => false,
  isSymbolicLink: () => true,
} as MockStat;

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function mockFilesystem(
  sources: Record<string, MockStat>,
  occupiedDestinations: string[] = [],
): void {
  const occupied = new Set(occupiedDestinations.map((entry) => path.resolve(entry)));
  vi.mocked(fs.lstat).mockImplementation(async (filePath) => {
    const resolved = path.resolve(String(filePath));
    const source = Object.entries(sources)
      .find(([candidate]) => path.resolve(candidate) === resolved);
    if (source) return source[1];
    if (resolved.includes(`${path.sep}.agents-commander-move-`)) {
      const stagedSource = Object.entries(sources)
        .find(([candidate]) => path.basename(candidate) === path.basename(resolved));
      if (stagedSource) return stagedSource[1];
    }
    if (occupied.has(resolved)) return fileStat;
    throw errno('ENOENT', `missing: ${resolved}`);
  });
}

const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const realChildProcess = await vi.importActual<typeof import('node:child_process')>(
  'node:child_process',
);

function runRealCommand(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    realChildProcess.execFile(file, args, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(String(stdout));
      }
    });
  });
}

async function setTestXattr(filePath: string, value: string): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      await runRealCommand('xattr', ['-w', 'com.agents-commander.test', value, filePath]);
      return true;
    }
    if (process.platform === 'linux') {
      await runRealCommand('setfattr', [
        '-n',
        'user.agents_commander_test',
        '-v',
        value,
        filePath,
      ]);
      return true;
    }
  } catch {
    // Minimal Linux environments often omit attr(1), and some filesystems do
    // not support user xattrs. Mode/mtime/inode assertions still run there.
  }
  return false;
}

async function readTestXattr(filePath: string): Promise<string> {
  if (process.platform === 'darwin') {
    return (await runRealCommand(
      'xattr',
      ['-p', 'com.agents-commander.test', filePath],
    )).trim();
  }
  return (await runRealCommand(
    'getfattr',
    ['--only-values', '-n', 'user.agents_commander_test', filePath],
  )).trim();
}

async function setTestSymlinkXattr(filePath: string, value: string): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      await runRealCommand(
        'xattr',
        ['-s', '-w', 'com.agents-commander.symlink-test', value, filePath],
      );
      return true;
    }
    if (process.platform === 'linux') {
      await runRealCommand('setfattr', [
        '-h',
        '-n',
        'user.agents_commander_symlink_test',
        '-v',
        value,
        filePath,
      ]);
      return true;
    }
  } catch {
    // Many Linux filesystems intentionally reject user xattrs on symlinks.
  }
  return false;
}

async function readTestSymlinkXattr(filePath: string): Promise<string> {
  if (process.platform === 'darwin') {
    return (await runRealCommand(
      'xattr',
      ['-s', '-p', 'com.agents-commander.symlink-test', filePath],
    )).trim();
  }
  return (await runRealCommand(
    'getfattr',
    ['-h', '--only-values', '-n', 'user.agents_commander_symlink_test', filePath],
  )).trim();
}

async function setTestAcl(filePath: string, directory: boolean): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      await runRealCommand('chmod', ['+a', 'everyone allow read', filePath]);
      return true;
    }
    if (process.platform === 'linux' && typeof process.getuid === 'function') {
      await runRealCommand('setfacl', [
        '-m',
        `u:${process.getuid()}:${directory ? 'rwx' : 'rw-'}`,
        filePath,
      ]);
      return true;
    }
  } catch {
    // ACL command-line tools and filesystem ACL support are optional.
  }
  return false;
}

async function readTestAcl(filePath: string): Promise<string> {
  if (process.platform === 'darwin') {
    const output = await runRealCommand('ls', ['-lde', filePath]);
    return output.split('\n').slice(1).join('\n').trim();
  }
  const output = await runRealCommand('getfacl', ['-cp', filePath]);
  return output
    .split('\n')
    .filter((line) => !line.startsWith('# file:'))
    .join('\n')
    .trim();
}

function useRealFilesystem(): void {
  vi.mocked(execFile).mockImplementation(realChildProcess.execFile);
  vi.mocked(fs.chmod).mockImplementation((filePath, mode) => realFs.chmod(filePath, mode));
  vi.mocked(fs.cp).mockImplementation((source, destination, options) => (
    realFs.cp(source, destination, options)
  ));
  vi.mocked(fs.copyFile).mockImplementation((source, destination, mode) => (
    realFs.copyFile(source, destination, mode)
  ));
  vi.mocked(fs.link).mockImplementation((existingPath, newPath) => (
    realFs.link(existingPath, newPath)
  ));
  vi.mocked(fs.lstat).mockImplementation((filePath, options) => (
    realFs.lstat(filePath, options)
  ) as ReturnType<typeof fs.lstat>);
  vi.mocked(fs.mkdtemp).mockImplementation((prefix, options) => (
    realFs.mkdtemp(prefix, options)
  ) as ReturnType<typeof fs.mkdtemp>);
  vi.mocked(fs.mkdir).mockImplementation((directoryPath, options) => (
    realFs.mkdir(directoryPath, options)
  ) as ReturnType<typeof fs.mkdir>);
  vi.mocked(fs.readlink).mockImplementation((filePath, options) => (
    realFs.readlink(filePath, options)
  ) as ReturnType<typeof fs.readlink>);
  vi.mocked(fs.rename).mockImplementation((oldPath, newPath) => (
    realFs.rename(oldPath, newPath)
  ));
  vi.mocked(fs.rmdir).mockImplementation((directoryPath, options) => (
    realFs.rmdir(directoryPath, options)
  ));
  vi.mocked(fs.rm).mockImplementation((filePath, options) => realFs.rm(filePath, options));
  vi.mocked(fs.stat).mockImplementation((filePath, options) => (
    realFs.stat(filePath, options)
  ) as ReturnType<typeof fs.stat>);
  vi.mocked(fs.symlink).mockImplementation((target, filePath, type) => (
    realFs.symlink(target, filePath, type)
  ));
  vi.mocked(fs.unlink).mockImplementation((filePath) => realFs.unlink(filePath));
  vi.mocked(fs.writeFile).mockImplementation((filePath, data, options) => (
    realFs.writeFile(filePath, data, options)
  ) as ReturnType<typeof fs.writeFile>);
}

describe('file operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execFile).mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, _args.includes('--probe') ? '/usr/bin/python3' : '', '');
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);
    vi.mocked(fs.chmod).mockResolvedValue(undefined);
    vi.mocked(fs.cp).mockResolvedValue(undefined);
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.link).mockResolvedValue(undefined);
    vi.mocked(fs.mkdtemp).mockImplementation(async (prefix) => `${String(prefix)}test`);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.readlink).mockResolvedValue('../target.txt');
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.rmdir).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue(directoryStat);
    vi.mocked(fs.symlink).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  describe('name validation', () => {
    it.each([
      '',
      '   ',
      '.',
      '..',
      ' ../escape ',
      '../escape',
      'nested/name',
      'nested\\name',
      '/absolute',
      'C:\\absolute',
      'nul\u0000byte',
      'line\nbreak',
      'delete\u007f',
      'control\u0085name',
    ])('rejects unsafe entry name %j', (name) => {
      expect(() => validateEntryName(name)).toThrow(InvalidEntryNameError);
    });

    it('accepts a safe leaf name without rewriting it', () => {
      expect(validateEntryName(' report final.md ')).toBe(' report final.md ');
    });
  });

  describe('copy', () => {
    it('copies regular files with COPYFILE_EXCL', async () => {
      mockFilesystem({ 'src.txt': fileStat });

      await copyFile('src.txt', 'dest.txt');

      expect(fs.copyFile).toHaveBeenCalledWith(
        'src.txt',
        'dest.txt',
        constants.COPYFILE_EXCL,
      );
    });

    it('copies directories without merging or overwriting', async () => {
      mockFilesystem({ 'src-dir': directoryStat });

      await copyFile('src-dir', 'dest-dir');

      expect(fs.mkdir).toHaveBeenCalledWith('dest-dir', {
        recursive: false,
        mode: 0o750,
      });
      expect(fs.cp).toHaveBeenCalledWith('src-dir', 'dest-dir', {
        recursive: true,
        dereference: false,
        force: false,
        errorOnExist: true,
      });
    });

    it('copies symbolic links without dereferencing their targets', async () => {
      mockFilesystem({ 'source-link': symlinkStat });

      await copyFile('source-link', 'dest-link');

      expect(fs.readlink).toHaveBeenCalledWith('source-link');
      expect(fs.symlink).toHaveBeenCalledWith('../target.txt', 'dest-link');
      expect(fs.copyFile).not.toHaveBeenCalled();
      expect(fs.cp).not.toHaveBeenCalled();
    });

    it.each([
      ['existing regular file', fileStat],
      ['existing directory', directoryStat],
      ['broken symbolic link', symlinkStat],
    ])('refuses to overwrite an %s', async (_label, occupiedStat) => {
      vi.mocked(fs.lstat).mockImplementation(async (filePath) => (
        path.resolve(String(filePath)) === path.resolve('src.txt')
          ? fileStat
          : occupiedStat
      ));

      await expect(copyFile('src.txt', 'dest.txt')).rejects.toMatchObject({
        name: 'FileConflictError',
        code: 'EEXIST',
        operation: 'copy',
        completed: 0,
        total: 1,
      });
      expect(fs.copyFile).not.toHaveBeenCalled();
      expect(fs.cp).not.toHaveBeenCalled();
    });

    it('converts a raced exclusive-copy conflict to FileConflictError', async () => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(fs.copyFile).mockRejectedValue(errno('EEXIST'));

      await expect(copyFile('src.txt', 'dest.txt')).rejects.toBeInstanceOf(FileConflictError);
    });

    it('rejects copying an item onto itself', async () => {
      mockFilesystem({ 'same.txt': fileStat });

      await expect(copyFile('same.txt', './same.txt')).rejects.toMatchObject({
        name: 'FileConflictError',
        completed: 0,
        total: 1,
      });
      expect(fs.copyFile).not.toHaveBeenCalled();
    });

    it('rejects copying a directory into its own descendant', async () => {
      mockFilesystem({ project: directoryStat });

      await expect(copyFile('project', 'project/archive/copy')).rejects.toMatchObject({
        name: 'FileOperationError',
        code: 'EINVAL',
        operation: 'copy',
      });
      expect(fs.cp).not.toHaveBeenCalled();
    });
  });

  describe('move', () => {
    it('moves a file with an atomic no-replace hard link', async () => {
      mockFilesystem({ 'src.txt': fileStat });

      await moveFile('src.txt', 'dest.txt');

      const stagingDirectory = `${path.join('.', '.agents-commander-move-')}test`;
      const stagedSource = path.join(stagingDirectory, 'src.txt');
      expect(fs.rename).toHaveBeenCalledWith('src.txt', stagedSource);
      expect(fs.link).toHaveBeenCalledWith(stagedSource, 'dest.txt');
      expect(fs.rm).toHaveBeenCalledWith(stagedSource, {
        recursive: true,
        force: false,
      });
    });

    it('moves a directory with a metadata-preserving no-replace rename', async () => {
      mockFilesystem({ 'src-dir': directoryStat });

      await moveFile('src-dir', 'dest-dir');

      const stagingDirectory = `${path.join('.', '.agents-commander-move-')}test`;
      const stagedSource = path.join(stagingDirectory, 'src-dir');
      expect(fs.rename).toHaveBeenCalledWith('src-dir', stagedSource);
      expect(execFile).toHaveBeenCalledWith(
        '/usr/bin/python3',
        expect.arrayContaining([stagedSource, 'dest-dir']),
        expect.objectContaining({ encoding: 'utf8' }),
        expect.any(Function),
      );
      expect(fs.cp).not.toHaveBeenCalled();
      expect(fs.rm).not.toHaveBeenCalledWith(stagedSource, expect.anything());
    });

    it('rejects a cross-filesystem directory move before creating a destination', async () => {
      mockFilesystem({ 'src-dir': directoryStat });
      vi.mocked(execFile)
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(null, '/usr/bin/python3', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile))
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(null, '', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile))
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(new Error('cross-device'), '', 'EXDEV');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile))
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(null, '', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile));

      await expect(moveFile('src-dir', 'dest-dir')).rejects.toMatchObject({
        code: 'EXDEV',
        operation: 'move',
      });
      expect(fs.mkdir).not.toHaveBeenCalledWith('dest-dir', expect.anything());
      expect(fs.cp).not.toHaveBeenCalled();
    });

    it('treats moving an existing item onto itself as a no-op', async () => {
      mockFilesystem({ 'same.txt': fileStat });

      await moveFile('same.txt', './same.txt');

      expect(fs.rename).not.toHaveBeenCalled();
      expect(fs.link).not.toHaveBeenCalled();
      expect(fs.copyFile).not.toHaveBeenCalled();
      expect(fs.rm).not.toHaveBeenCalled();
    });

    it.each([
      ['missing interpreter', errno('ENOENT', 'python3 missing'), ''],
      ['broken executable', errno('EACCES', 'python3 is not executable'), ''],
      ['unsupported helper', new Error('helper rejected probe'), 'ENOTSUP'],
      ['timed-out helper', errno('ETIMEDOUT', 'probe timed out'), ''],
    ])('leaves the source untouched when the %s fails preflight', async (
      _label,
      probeError,
      stderr,
    ) => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(execFile).mockImplementationOnce((((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(probeError, '', stderr);
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile));

      await expect(moveFile('src.txt', 'dest.txt')).rejects.toMatchObject({
        name: 'FileOperationError',
        operation: 'move',
      });
      expect(fs.mkdtemp).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
      expect(fs.link).not.toHaveBeenCalled();
    });

    it('rejects a probe that does not identify an absolute working interpreter', async () => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(execFile).mockImplementationOnce((((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, 'python3', '');
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile));

      await expect(moveFile('src.txt', 'dest.txt')).rejects.toMatchObject({
        code: 'ENOTSUP',
      });
      expect(fs.mkdtemp).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('fails before staging when the source filesystem rejects no-replace rename', async () => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(execFile)
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(null, '/usr/bin/python3', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile))
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(new Error('filesystem unsupported'), '', 'ENOTSUP');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile));

      await expect(moveFile('src.txt', 'dest.txt')).rejects.toMatchObject({
        code: 'ENOTSUP',
        operation: 'move',
      });
      expect(execFile).toHaveBeenNthCalledWith(
        2,
        '/usr/bin/python3',
        expect.arrayContaining(['--filesystem-probe']),
        expect.anything(),
        expect.any(Function),
      );
      expect(fs.mkdtemp).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
      expect(fs.link).not.toHaveBeenCalled();
    });

    it('uses the cached primitive to restore after a post-stage helper timeout', async () => {
      mockFilesystem({ 'src-dir': directoryStat });
      vi.mocked(execFile)
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(null, '/opt/cached/python3', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile))
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(null, '', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile))
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(errno('ETIMEDOUT', 'helper timed out'), '', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile))
        .mockImplementationOnce((((
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(null, '', '');
          return {} as ReturnType<typeof execFile>;
        }) as typeof execFile));

      const error = await moveFile('src-dir', 'dest-dir')
        .catch((moveError: unknown) => moveError);
      expect(error).toMatchObject({
        code: 'ETIMEDOUT',
        recoveryPath: undefined,
      });
      expect(execFile).toHaveBeenNthCalledWith(
        3,
        '/opt/cached/python3',
        expect.arrayContaining(['dest-dir']),
        expect.anything(),
        expect.any(Function),
      );
      expect(execFile).toHaveBeenNthCalledWith(
        4,
        '/opt/cached/python3',
        expect.arrayContaining(['src-dir']),
        expect.anything(),
        expect.any(Function),
      );
      expect(fs.rmdir).toHaveBeenCalledWith(
        expect.stringContaining('.agents-commander-move-'),
      );
    });

    it('refuses an occupied destination before rename', async () => {
      mockFilesystem({ 'src.txt': fileStat }, ['dest.txt']);

      await expect(moveFile('src.txt', 'dest.txt')).rejects.toBeInstanceOf(FileConflictError);
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('refuses a destination that appears between preflight and the no-replace link', async () => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(fs.link)
        .mockRejectedValueOnce(errno('EEXIST', 'raced destination'))
        .mockResolvedValueOnce(undefined);

      await expect(moveFile('src.txt', 'dest.txt')).rejects.toMatchObject({
        name: 'FileConflictError',
        code: 'EEXIST',
        operation: 'move',
        completed: 0,
        total: 1,
      });
      expect(fs.link).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('.agents-commander-move-'),
        'dest.txt',
      );
      expect(fs.link).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('.agents-commander-move-'),
        'src.txt',
      );
    });

    it('rejects EXDEV before destination publication and restores the staged source', async () => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(fs.link)
        .mockRejectedValueOnce(errno('EXDEV', 'cross-device'))
        .mockResolvedValueOnce(undefined);

      await expect(moveFile('src.txt', 'dest.txt')).rejects.toMatchObject({
        name: 'FileOperationError',
        code: 'EXDEV',
        operation: 'move',
      });

      expect(fs.link).toHaveBeenLastCalledWith(
        expect.stringContaining('.agents-commander-move-'),
        'src.txt',
      );
      expect(fs.copyFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.agents-commander-move-'),
        'dest.txt',
        expect.anything(),
      );
      expect(fs.rm).not.toHaveBeenCalledWith('src.txt', expect.anything());
    });

    it('uses native no-replace rename when hard links are unsupported', async () => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(fs.link).mockRejectedValueOnce(errno('EPERM', 'links unsupported'));

      await moveFile('src.txt', 'dest.txt');

      expect(execFile).toHaveBeenCalledWith(
        '/usr/bin/python3',
        expect.arrayContaining(['dest.txt']),
        expect.objectContaining({ encoding: 'utf8' }),
        expect.any(Function),
      );
      expect(fs.copyFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.agents-commander-move-'),
        'dest.txt',
        expect.anything(),
      );
    });

    it('reports a typed recovery path when staged-source cleanup fails', async () => {
      mockFilesystem({ 'src.txt': fileStat });
      vi.mocked(fs.rm).mockRejectedValue(errno('EACCES', 'permission denied'));

      await expect(moveFile('src.txt', 'dest.txt')).rejects.toMatchObject({
        name: 'FileOperationError',
        code: 'EACCES',
        operation: 'move',
        source: 'src.txt',
        destination: 'dest.txt',
        recoveryPath: expect.stringContaining('.agents-commander-move-'),
      });
      expect(fs.copyFile).not.toHaveBeenCalledWith(
        expect.stringContaining('.agents-commander-move-'),
        'dest.txt',
        expect.anything(),
      );
    });

    it('leaves no staging residue when python3 is missing on the real filesystem', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-no-python-'));
      const source = path.join(root, 'source');
      const destination = path.join(root, 'destination');
      await realFs.mkdir(source);
      await realFs.writeFile(path.join(source, 'original.txt'), 'original');
      const before = await realFs.lstat(source);
      vi.mocked(execFile).mockImplementation((((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(errno('ENOENT', 'python3 missing'), '', '');
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile));

      try {
        await expect(moveFile(source, destination)).rejects.toMatchObject({ code: 'ENOENT' });
        const after = await realFs.lstat(source);
        expect(after.dev).toBe(before.dev);
        expect(after.ino).toBe(before.ino);
        await expect(realFs.readFile(path.join(source, 'original.txt'), 'utf8'))
          .resolves.toBe('original');
        await expect(realFs.lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await realFs.readdir(root)).toEqual(['source']);
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('leaves the real source untouched when its filesystem probe reports ENOTSUP', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-fs-probe-'));
      const source = path.join(root, 'source.txt');
      const destination = path.join(root, 'destination.txt');
      await realFs.writeFile(source, 'original');
      const before = await realFs.lstat(source);

      vi.mocked(execFile).mockImplementation(((file, args, options, callback) => {
        if (args?.includes('--filesystem-probe')) {
          callback(new Error('filesystem unsupported'), '', 'ENOTSUP');
          return {} as ReturnType<typeof execFile>;
        }
        return realChildProcess.execFile(file, args, options, callback);
      }) as typeof execFile);

      try {
        await expect(moveFile(source, destination)).rejects.toMatchObject({
          code: 'ENOTSUP',
        });
        const after = await realFs.lstat(source);
        expect(after.dev).toBe(before.dev);
        expect(after.ino).toBe(before.ino);
        await expect(realFs.readFile(source, 'utf8')).resolves.toBe('original');
        await expect(realFs.lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await realFs.readdir(root)).toEqual(['source.txt']);
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('uses the cached absolute interpreter after PATH changes following the probe', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-path-race-'));
      const source = path.join(root, 'source');
      const destination = path.join(root, 'destination');
      await realFs.mkdir(source);
      await realFs.writeFile(path.join(source, 'original.txt'), 'original');
      const originalPath = process.env.PATH;
      let cachedExecutable: string | undefined;

      vi.mocked(execFile).mockImplementation(((file, args, options, callback) => {
        if (args?.includes('--probe')) {
          return realChildProcess.execFile(file, args, options, (error, stdout, stderr) => {
            if (!error) {
              cachedExecutable = String(stdout).trim();
              process.env.PATH = '/agents-commander-intentionally-missing';
            }
            callback(error, stdout, stderr);
          });
        }
        return realChildProcess.execFile(file, args, options, callback);
      }) as typeof execFile);

      try {
        await moveFile(source, destination);
        expect(cachedExecutable).toBeTruthy();
        expect(path.isAbsolute(cachedExecutable!)).toBe(true);
        expect(execFile).toHaveBeenCalledWith(
          cachedExecutable,
          expect.arrayContaining([destination]),
          expect.anything(),
          expect.any(Function),
        );
        await expect(realFs.readFile(path.join(destination, 'original.txt'), 'utf8'))
          .resolves.toBe('original');
      } finally {
        process.env.PATH = originalPath;
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('preserves a destination raced in after preflight on the real filesystem', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-move-race-'));
      const source = path.join(root, 'source.txt');
      const destination = path.join(root, 'destination.txt');
      await realFs.writeFile(source, 'original source');

      let injected = false;
      vi.mocked(fs.link).mockImplementation(async (existingPath, newPath) => {
        if (!injected && path.resolve(String(newPath)) === path.resolve(destination)) {
          injected = true;
          await realFs.writeFile(destination, 'raced destination');
        }
        await realFs.link(existingPath, newPath);
      });

      try {
        await expect(moveFile(source, destination)).rejects.toBeInstanceOf(FileConflictError);
        await expect(realFs.readFile(destination, 'utf8')).resolves.toBe('raced destination');
        await expect(realFs.readFile(source, 'utf8')).resolves.toBe('original source');
        expect((await realFs.readdir(root)).sort()).toEqual([
          'destination.txt',
          'source.txt',
        ]);
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('does not merge into a directory raced in after preflight', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-dir-race-'));
      const source = path.join(root, 'source');
      const destination = path.join(root, 'destination');
      await realFs.mkdir(source);
      await realFs.writeFile(path.join(source, 'original.txt'), 'original source');

      let injected = false;
      vi.mocked(execFile).mockImplementation(((file, args, options, callback) => {
        void (async () => {
          if (!injected && args?.includes(destination)) {
            injected = true;
            await realFs.mkdir(destination);
            await realFs.writeFile(path.join(destination, 'racer.txt'), 'raced destination');
          }
          realChildProcess.execFile(file, args, options, callback);
        })();
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      try {
        await expect(moveFile(source, destination)).rejects.toBeInstanceOf(FileConflictError);
        await expect(realFs.readdir(destination)).resolves.toEqual(['racer.txt']);
        await expect(realFs.readFile(path.join(source, 'original.txt'), 'utf8'))
          .resolves.toBe('original source');
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('preserves file inode, mode, mtime, and xattrs on a real move', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-file-meta-'));
      const source = path.join(root, 'source.txt');
      const destination = path.join(root, 'destination.txt');
      const timestamp = new Date('2024-02-03T04:05:06.000Z');
      await realFs.writeFile(source, 'metadata');
      await realFs.chmod(source, 0o640);
      await realFs.utimes(source, timestamp, timestamp);
      const hasXattr = await setTestXattr(source, 'file-metadata');
      const hasAcl = await setTestAcl(source, false);
      if (process.platform === 'darwin') {
        expect(hasXattr).toBe(true);
        expect(hasAcl).toBe(true);
      }
      const aclBefore = hasAcl ? await readTestAcl(source) : undefined;
      const before = await realFs.lstat(source);

      try {
        await moveFile(source, destination);
        const after = await realFs.lstat(destination);
        expect(after.dev).toBe(before.dev);
        expect(after.ino).toBe(before.ino);
        expect(after.mode & 0o777).toBe(before.mode & 0o777);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        if (hasXattr) {
          await expect(readTestXattr(destination)).resolves.toBe('file-metadata');
        }
        if (hasAcl) {
          await expect(readTestAcl(destination)).resolves.toBe(aclBefore);
        }
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('preserves directory inode, root mode, mtime, and xattrs on a real move', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-dir-meta-'));
      const source = path.join(root, 'source');
      const destination = path.join(root, 'destination');
      const timestamp = new Date('2023-06-07T08:09:10.000Z');
      await realFs.mkdir(source);
      await realFs.writeFile(path.join(source, 'child.txt'), 'child');
      await realFs.chmod(source, 0o1777);
      await realFs.utimes(source, timestamp, timestamp);
      const hasXattr = await setTestXattr(source, 'directory-metadata');
      const hasAcl = await setTestAcl(source, true);
      if (process.platform === 'darwin') {
        expect(hasXattr).toBe(true);
        expect(hasAcl).toBe(true);
      }
      const aclBefore = hasAcl ? await readTestAcl(source) : undefined;
      const before = await realFs.lstat(source);

      try {
        await moveFile(source, destination);
        const after = await realFs.lstat(destination);
        expect(after.dev).toBe(before.dev);
        expect(after.ino).toBe(before.ino);
        expect(after.mode & 0o7777).toBe(0o1777);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        if (hasXattr) {
          await expect(readTestXattr(destination)).resolves.toBe('directory-metadata');
        }
        if (hasAcl) {
          await expect(readTestAcl(destination)).resolves.toBe(aclBefore);
        }
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('moves a relative symlink without following or rewriting its raw target', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-link-relative-'));
      const sourceDirectory = path.join(root, 'from');
      const destinationDirectory = path.join(root, 'to');
      const targetDirectory = path.join(root, 'target');
      await Promise.all([
        realFs.mkdir(sourceDirectory),
        realFs.mkdir(destinationDirectory),
        realFs.mkdir(targetDirectory),
      ]);
      await realFs.writeFile(path.join(targetDirectory, 'value.txt'), 'target');
      const source = path.join(sourceDirectory, 'relative-link');
      const destination = path.join(destinationDirectory, 'relative-link');
      const rawTarget = '../target/value.txt';
      await realFs.symlink(rawTarget, source);
      const hasXattr = await setTestSymlinkXattr(source, 'symlink-metadata');
      if (process.platform === 'darwin') {
        expect(hasXattr).toBe(true);
      }
      const before = await realFs.lstat(source);

      try {
        await moveFile(source, destination);
        const after = await realFs.lstat(destination);
        expect(after.isSymbolicLink()).toBe(true);
        expect(after.dev).toBe(before.dev);
        expect(after.ino).toBe(before.ino);
        await expect(realFs.readlink(destination)).resolves.toBe(rawTarget);
        if (hasXattr) {
          await expect(readTestSymlinkXattr(destination)).resolves.toBe('symlink-metadata');
        }
        await expect(realFs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('moves an absolute symlink as the same symlink inode, never as its target file', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-link-absolute-'));
      const target = path.join(root, 'target.txt');
      const source = path.join(root, 'absolute-link');
      const destination = path.join(root, 'moved-link');
      await realFs.writeFile(target, 'target contents');
      await realFs.symlink(target, source);
      const before = await realFs.lstat(source);

      try {
        await moveFile(source, destination);
        const after = await realFs.lstat(destination);
        expect(after.isSymbolicLink()).toBe(true);
        expect(after.dev).toBe(before.dev);
        expect(after.ino).toBe(before.ino);
        await expect(realFs.readlink(destination)).resolves.toBe(target);
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('preserves a symlink destination raced in after preflight and restores the source', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-link-race-'));
      const source = path.join(root, 'source-link');
      const destination = path.join(root, 'destination-link');
      const rawTarget = 'missing-relative-target';
      await realFs.symlink(rawTarget, source);
      const before = await realFs.lstat(source);

      let injected = false;
      vi.mocked(execFile).mockImplementation(((file, args, options, callback) => {
        void (async () => {
          if (!injected && args?.includes(destination)) {
            injected = true;
            await realFs.writeFile(destination, 'raced destination');
          }
          realChildProcess.execFile(file, args, options, callback);
        })();
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      try {
        await expect(moveFile(source, destination)).rejects.toBeInstanceOf(FileConflictError);
        await expect(realFs.readFile(destination, 'utf8')).resolves.toBe('raced destination');
        const restored = await realFs.lstat(source);
        expect(restored.isSymbolicLink()).toBe(true);
        expect(restored.dev).toBe(before.dev);
        expect(restored.ino).toBe(before.ino);
        await expect(realFs.readlink(source)).resolves.toBe(rawTarget);
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('keeps a symlink recoverable in staging when destination and restore both race', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-link-recovery-'));
      const source = path.join(root, 'source-link');
      const destination = path.join(root, 'destination-link');
      const rawTarget = '../still-raw';
      await realFs.symlink(rawTarget, source);
      const before = await realFs.lstat(source);

      let destinationInjected = false;
      let sourceInjected = false;
      vi.mocked(execFile).mockImplementation(((file, args, options, callback) => {
        void (async () => {
          if (!destinationInjected && args?.includes(destination)) {
            destinationInjected = true;
            await realFs.writeFile(destination, 'raced destination');
          } else if (!sourceInjected && args?.includes(source)) {
            sourceInjected = true;
            await realFs.writeFile(source, 'replacement source');
          }
          realChildProcess.execFile(file, args, options, callback);
        })();
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);

      try {
        const error = await moveFile(source, destination).catch((moveError: unknown) => moveError);
        expect(error).toMatchObject({
          name: 'FileOperationError',
          code: 'EEXIST',
          recoveryPath: expect.stringContaining('.agents-commander-move-'),
        });
        expect((error as Error).message).toContain(
          (error as FileOperationError).recoveryPath!,
        );
        await expect(realFs.readFile(source, 'utf8')).resolves.toBe('replacement source');
        const recoveryPath = (error as FileOperationError).recoveryPath!;
        const recoveryStat = await realFs.lstat(recoveryPath);
        expect(recoveryStat.isSymbolicLink()).toBe(true);
        expect(recoveryStat.dev).toBe(before.dev);
        expect(recoveryStat.ino).toBe(before.ino);
        await expect(realFs.readlink(recoveryPath)).resolves.toBe(rawTarget);
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

    it('never deletes a replacement source when an EXDEV move is rejected', async () => {
      useRealFilesystem();
      const root = await realFs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-exdev-race-'));
      const source = path.join(root, 'source.txt');
      const destination = path.join(root, 'destination.txt');
      await realFs.writeFile(source, 'original source');

      let injected = false;
      vi.mocked(fs.link).mockImplementation(async (stagedSource, target) => {
        if (!injected && path.resolve(String(target)) === path.resolve(destination)) {
          injected = true;
          await realFs.writeFile(source, 'replacement source');
          throw errno('EXDEV', 'simulated cross-device move');
        }
        await realFs.link(stagedSource, target);
      });

      try {
        const error = await moveFile(source, destination).catch((moveError: unknown) => moveError);
        expect(error).toMatchObject({
          name: 'FileOperationError',
          code: 'EXDEV',
          recoveryPath: expect.stringContaining('.agents-commander-move-'),
        });
        await expect(realFs.readFile(source, 'utf8')).resolves.toBe('replacement source');
        await expect(realFs.lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(realFs.readFile((error as FileOperationError).recoveryPath!, 'utf8'))
          .resolves.toBe('original source');
      } finally {
        await realFs.rm(root, { recursive: true, force: true });
      }
    });

  });

  describe('batch preflight and progress', () => {
    it('rejects duplicate destination basenames before inspecting or copying', async () => {
      await expect(copyFiles(
        ['/one/shared.txt', '/two/shared.txt'],
        '/target',
      )).rejects.toMatchObject({
        name: 'FileConflictError',
        operation: 'copy',
        completed: 0,
        total: 2,
      });
      expect(fs.lstat).not.toHaveBeenCalled();
      expect(fs.copyFile).not.toHaveBeenCalled();
    });

    it('preflights every destination before the first batch write', async () => {
      mockFilesystem(
        {
          '/one/a.txt': fileStat,
          '/two/b.txt': fileStat,
        },
        ['/target/b.txt'],
      );

      await expect(copyFiles(
        ['/one/a.txt', '/two/b.txt'],
        '/target',
      )).rejects.toMatchObject({
        name: 'FileConflictError',
        completed: 0,
        total: 2,
        destination: path.join('/target', 'b.txt'),
      });
      expect(fs.copyFile).not.toHaveBeenCalled();
    });

    it('reports completed batch items when a later copy fails', async () => {
      mockFilesystem({
        '/one/a.txt': fileStat,
        '/two/b.txt': fileStat,
      });
      vi.mocked(fs.copyFile)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(errno('ENOSPC', 'disk full'));

      await expect(copyFiles(
        ['/one/a.txt', '/two/b.txt'],
        '/target',
      )).rejects.toMatchObject({
        name: 'FileOperationError',
        operation: 'copy',
        code: 'ENOSPC',
        completed: 1,
        total: 2,
        source: '/two/b.txt',
      });
      expect(fs.copyFile).toHaveBeenCalledTimes(2);
    });

    it('reports progress for successful and no-op batch moves', async () => {
      mockFilesystem({
        '/target/a.txt': fileStat,
        '/source/b.txt': fileStat,
      });
      const progress = vi.fn();

      await moveFiles(
        ['/target/a.txt', '/source/b.txt'],
        '/target',
        progress,
      );

      expect(fs.rename).toHaveBeenCalledTimes(1);
      expect(fs.rename).toHaveBeenCalledWith(
        '/source/b.txt',
        expect.stringContaining('.agents-commander-move-'),
      );
      expect(progress).toHaveBeenNthCalledWith(1, 1, 2, 'a.txt');
      expect(progress).toHaveBeenNthCalledWith(2, 2, 2, 'b.txt');
      expect(vi.mocked(execFile).mock.calls.filter(([file]) => file === 'python3'))
        .toHaveLength(1);
      expect(vi.mocked(execFile).mock.calls.filter(([, args]) => (
        args?.includes('--filesystem-probe')
      ))).toHaveLength(1);
    });

    it('preflights every distinct source filesystem before a batch mutation', async () => {
      const firstFilesystemStat = {
        ...directoryStat,
        dev: 101,
      } as MockStat;
      const secondFilesystemStat = {
        ...directoryStat,
        dev: 202,
      } as MockStat;
      mockFilesystem({
        '/one/a.txt': fileStat,
        '/two/b.txt': fileStat,
      });
      vi.mocked(fs.stat).mockImplementation(async (filePath) => (
        String(filePath).startsWith('/one')
          ? firstFilesystemStat
          : secondFilesystemStat
      ));

      await moveFiles(
        ['/one/a.txt', '/two/b.txt'],
        '/target',
      );

      const filesystemProbeCalls = vi.mocked(execFile).mock.calls
        .filter(([, args]) => args?.includes('--filesystem-probe'));
      expect(filesystemProbeCalls).toHaveLength(2);
      expect(filesystemProbeCalls.map(([, args]) => args?.at(-1)).sort())
        .toEqual(['/one', '/two']);
      expect(fs.rename).toHaveBeenCalledTimes(2);
    });
  });

  describe('mkdir and delete', () => {
    it('creates directories non-recursively', async () => {
      await createDirectory('new-dir');
      expect(fs.mkdir).toHaveBeenCalledWith('new-dir', { recursive: false });
    });

    it('reports an existing directory as a typed conflict', async () => {
      vi.mocked(fs.mkdir).mockRejectedValue(errno('EEXIST', 'already exists'));

      await expect(createDirectory('existing')).rejects.toMatchObject({
        name: 'FileConflictError',
        code: 'EEXIST',
        operation: 'mkdir',
        destination: 'existing',
        completed: 0,
        total: 1,
      });
    });

    it('wraps delete failures with operation context', async () => {
      vi.mocked(fs.rm).mockRejectedValue(errno('EACCES', 'permission denied'));

      await expect(deleteFile('target-path')).rejects.toMatchObject({
        name: 'FileOperationError',
        operation: 'delete',
        source: 'target-path',
        code: 'EACCES',
        completed: 0,
        total: 1,
      });
    });
  });
});
