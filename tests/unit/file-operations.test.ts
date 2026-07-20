import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { copyFile, deleteFile, moveFile } from '../../src/file-manager/file-operations.js';

vi.mock('node:fs/promises', () => ({
  default: {
    cp: vi.fn(),
    copyFile: vi.fn(),
    lstat: vi.fn(),
    mkdir: vi.fn(),
    readlink: vi.fn(),
    readdir: vi.fn(),
    rename: vi.fn(),
    rm: vi.fn(),
    stat: vi.fn(),
    symlink: vi.fn(),
  },
}));

describe('file operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses fs.cp for directory copies', async () => {
    vi.mocked(fs.lstat).mockResolvedValue({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as Awaited<ReturnType<typeof fs.lstat>>);
    vi.mocked(fs.cp).mockResolvedValue(undefined);

    await copyFile('src-dir', 'dest-dir');

    expect(fs.cp).toHaveBeenCalledWith('src-dir', 'dest-dir', { recursive: true, dereference: false });
    expect(fs.copyFile).not.toHaveBeenCalled();
  });

  it('uses fs.rm for deleting files and directories', async () => {
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    await deleteFile('target-path');

    expect(fs.rm).toHaveBeenCalledWith('target-path', { recursive: true, force: true });
  });

  it('falls back to copy and delete on EXDEV', async () => {
    vi.mocked(fs.rename).mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    vi.mocked(fs.lstat).mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
    } as Awaited<ReturnType<typeof fs.lstat>>);
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    await moveFile('src.txt', 'dest.txt');

    expect(fs.rename).toHaveBeenCalledWith('src.txt', 'dest.txt');
    expect(fs.copyFile).toHaveBeenCalledWith('src.txt', 'dest.txt');
    expect(fs.rm).toHaveBeenCalledWith('src.txt', { recursive: true, force: true });
  });

  it('rethrows non-EXDEV rename errors', async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
    vi.mocked(fs.rename).mockRejectedValue(error);

    await expect(moveFile('src.txt', 'dest.txt')).rejects.toBe(error);

    expect(fs.lstat).not.toHaveBeenCalled();
    expect(fs.copyFile).not.toHaveBeenCalled();
    expect(fs.rm).not.toHaveBeenCalled();
  });

  it('copies symbolic links without dereferencing their targets', async () => {
    vi.mocked(fs.lstat).mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => true,
    } as Awaited<ReturnType<typeof fs.lstat>>);
    vi.mocked(fs.readlink).mockResolvedValue('../target.txt');
    vi.mocked(fs.symlink).mockResolvedValue(undefined);

    await copyFile('source-link', 'dest-link');

    expect(fs.readlink).toHaveBeenCalledWith('source-link');
    expect(fs.symlink).toHaveBeenCalledWith('../target.txt', 'dest-link');
    expect(fs.copyFile).not.toHaveBeenCalled();
    expect(fs.cp).not.toHaveBeenCalled();
  });
});
