import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { getPackageInfo } from '../../src/utils/package-info.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('package metadata', () => {
  it('resolves package.json from source and bundled module layouts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-commander-package-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'agents-commander', version: '9.8.7' }),
    );

    const moduleUrl = pathToFileURL(path.join(root, 'dist', 'src', 'index.js')).href;
    expect(getPackageInfo(moduleUrl)).toEqual({
      name: 'agents-commander',
      version: '9.8.7',
    });
  });
});
