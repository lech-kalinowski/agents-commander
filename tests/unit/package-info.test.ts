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
  it('resolves package.json from source, entry, and split-chunk module layouts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-commander-package-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'agents-commander', version: '9.8.7' }),
    );
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'dist', 'package.json'),
      JSON.stringify({ name: 'unrelated-package', version: '1.0.0' }),
    );

    for (const modulePath of [
      path.join(root, 'src', 'utils', 'package-info.js'),
      path.join(root, 'dist', 'bin', 'agents-commander.js'),
      path.join(root, 'dist', 'chunk-runtime.js'),
    ]) {
      expect(getPackageInfo(pathToFileURL(modulePath).href)).toEqual({
        name: 'agents-commander',
        version: '9.8.7',
      });
    }
  });
});
