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
      const lstat = await fs.lstat(fullPath, { bigint: true });
      let stat = lstat;
      if (lstat.isSymbolicLink()) {
        try {
          stat = await fs.stat(fullPath, { bigint: true });
        } catch {
          // Keep broken symlinks visible so users can inspect or remove them.
        }
      }
      entries.push({
        name: dirent.name,
        fullPath,
        isDirectory: stat.isDirectory(),
        isSymlink: lstat.isSymbolicLink(),
        size: Number(stat.size),
        modified: stat.mtime,
        permissions: formatPermissions(Number(stat.mode)),
        extension: path.extname(dirent.name).toLowerCase(),
        deviceId: lstat.dev.toString(),
        inode: lstat.ino.toString(),
        identityMode: Number(lstat.mode),
        ctimeNs: lstat.ctimeNs.toString(),
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
    const lstat = await fs.lstat(filePath, { bigint: true });
    let stat = lstat;
    if (lstat.isSymbolicLink()) {
      try {
        stat = await fs.stat(filePath, { bigint: true });
      } catch {
        // Report metadata for the link itself when its target is missing.
      }
    }
    return {
      name: path.basename(filePath),
      fullPath: filePath,
      isDirectory: stat.isDirectory(),
      isSymlink: lstat.isSymbolicLink(),
      size: Number(stat.size),
      modified: stat.mtime,
      permissions: formatPermissions(Number(stat.mode)),
      extension: path.extname(filePath).toLowerCase(),
      deviceId: lstat.dev.toString(),
      inode: lstat.ino.toString(),
      identityMode: Number(lstat.mode),
      ctimeNs: lstat.ctimeNs.toString(),
    };
  } catch {
    return null;
  }
}
