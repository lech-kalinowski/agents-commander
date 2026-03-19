import fs from 'node:fs/promises';
import path from 'node:path';

export type ProgressCallback = (current: number, total: number, name: string) => void;

export async function copyFile(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await copyDirectory(src, dest);
  } else {
    await fs.copyFile(src, dest);
  }
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

export async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw err;
    }

    // Cross-device move: copy then delete
    await copyFile(src, dest);
    await deleteFile(src);
  }
}

export async function deleteFile(filePath: string): Promise<void> {
  await fs.rm(filePath, { recursive: true, force: true });
}

export async function createDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function copyFiles(
  sources: string[],
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const destPath = path.join(destDir, path.basename(src));
    onProgress?.(i + 1, sources.length, path.basename(src));
    await copyFile(src, destPath);
  }
}

export async function moveFiles(
  sources: string[],
  destDir: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const destPath = path.join(destDir, path.basename(src));
    onProgress?.(i + 1, sources.length, path.basename(src));
    await moveFile(src, destPath);
  }
}

export async function deleteFiles(
  sources: string[],
  onProgress?: ProgressCallback,
): Promise<void> {
  for (let i = 0; i < sources.length; i++) {
    onProgress?.(i + 1, sources.length, path.basename(sources[i]));
    await deleteFile(sources[i]);
  }
}
