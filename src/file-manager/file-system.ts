import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry } from './types.js';

export async function readDirectory(dirPath: string, showHidden: boolean): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const dirents = await fs.readdir(dirPath, { withFileTypes: true });

  for (const dirent of dirents) {
    if (!showHidden && dirent.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, dirent.name);
    try {
      const stat = await fs.stat(fullPath);
      const lstat = await fs.lstat(fullPath);
      entries.push({
        name: dirent.name,
        fullPath,
        isDirectory: stat.isDirectory(),
        isSymlink: lstat.isSymbolicLink(),
        size: stat.size,
        modified: stat.mtime,
        permissions: formatPermissions(stat.mode),
        extension: path.extname(dirent.name).toLowerCase(),
      });
    } catch {
      // Skip files we can't stat (broken symlinks, etc.)
    }
  }

  return entries;
}

function formatPermissions(mode: number): string {
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const owner = perms[(mode >> 6) & 7];
  const group = perms[(mode >> 3) & 7];
  const other = perms[mode & 7];
  return `${owner}${group}${other}`;
}

export async function getFileInfo(filePath: string): Promise<FileEntry | null> {
  try {
    const stat = await fs.stat(filePath);
    const lstat = await fs.lstat(filePath);
    return {
      name: path.basename(filePath),
      fullPath: filePath,
      isDirectory: stat.isDirectory(),
      isSymlink: lstat.isSymbolicLink(),
      size: stat.size,
      modified: stat.mtime,
      permissions: formatPermissions(stat.mode),
      extension: path.extname(filePath).toLowerCase(),
    };
  } catch {
    return null;
  }
}
