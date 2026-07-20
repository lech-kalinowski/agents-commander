import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getFileInfo, readDirectory } from '../../src/file-manager/file-system.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('file system', () => {
  it('keeps broken symbolic links visible', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-'));
    tempDirs.push(dir);
    const linkPath = path.join(dir, 'broken-link');
    await fs.symlink('missing-target', linkPath);

    const entries = await readDirectory(dir, true);
    const link = entries.find((entry) => entry.name === 'broken-link');

    expect(link).toMatchObject({
      fullPath: linkPath,
      isDirectory: false,
      isSymlink: true,
    });
    await expect(getFileInfo(linkPath)).resolves.toMatchObject({
      isDirectory: false,
      isSymlink: true,
    });
  });
});
