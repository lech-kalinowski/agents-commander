import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findBuiltinDir,
  loadTemplates,
  refreshTemplates,
} from '../../src/templates/loader.js';

const tempDirs: string[] = [];

afterEach(() => {
  refreshTemplates();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('template loader', () => {
  it('loads the complete built-in template library from source', () => {
    refreshTemplates();
    const builtins = loadTemplates().filter((template) => template.source === 'builtin');
    expect(builtins).toHaveLength(121);
  });

  it('finds dist/templates relative to a bundled entry point', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-commander-templates-'));
    tempDirs.push(root);
    const entryDir = path.join(root, 'dist', 'src');
    const templatesDir = path.join(root, 'dist', 'templates');
    fs.mkdirSync(entryDir, { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(entryDir, 'index.js')).href;
    expect(findBuiltinDir(moduleUrl, path.join(root, 'unrelated'))).toBe(templatesDir);
  });
});
