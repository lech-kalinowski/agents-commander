import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findBuiltinDir,
  loadTemplates,
  refreshTemplates,
} from '../../src/templates/loader.js';
import {
  bindTemplateProtocolCapability,
  hasLegacyProtocolMarkers,
} from '../../src/orchestration/protocol.js';

vi.mock('../../src/utils/logger.js', () => ({ logger: { error: vi.fn() } }));

const tempDirs: string[] = [];

function packageFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-commander-templates-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'agents-commander' }));
  return root;
}

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

  it('can capability-bind every built-in collaboration template', () => {
    refreshTemplates();
    const capability = 'c'.repeat(43);
    const collaboration = loadTemplates().filter((template) => (
      template.source === 'builtin' && template.category === 'collaboration'
    ));

    expect(collaboration.length).toBeGreaterThan(0);
    for (const template of collaboration) {
      const bound = bindTemplateProtocolCapability(template.content, capability);
      expect(hasLegacyProtocolMarkers(bound), template.id).toBe(false);
      expect(bound, template.id).not.toContain('<session-key>');
    }
  });

  it.each(['dist/src/index.js', 'dist/chunk-templates.js', 'dist/templates/loader.js'])(
    'finds installed templates from %s with an unrelated working directory', (entry) => {
      const root = packageFixture();
      const templatesDir = path.join(root, 'dist', 'templates');
      fs.mkdirSync(templatesDir, { recursive: true });
      const unrelatedCwd = path.join(root, 'unrelated');
      fs.mkdirSync(unrelatedCwd);

      const moduleUrl = pathToFileURL(path.join(root, entry)).href;
      expect(findBuiltinDir(moduleUrl, unrelatedCwd)).toBe(templatesDir);
    },
  );

  it('does not substitute workspace or package-root templates when installed templates are absent', () => {
    const root = packageFixture();
    const workspace = path.join(root, 'workspace');
    for (const directory of [
      path.join(root, 'templates'),
      path.join(workspace, 'src', 'templates', 'builtin'),
      path.join(workspace, 'dist', 'templates'),
    ]) fs.mkdirSync(directory, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(root, 'dist', 'chunk-templates.js')).href;
    expect(findBuiltinDir(moduleUrl, workspace)).toBeNull();
  });

  it('resolves source templates independently of a conflicting working directory', () => {
    const root = packageFixture();
    const builtinDir = path.join(root, 'src', 'templates', 'builtin');
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(builtinDir, { recursive: true });
    fs.mkdirSync(path.join(workspace, 'dist', 'templates'), { recursive: true });

    const moduleUrl = pathToFileURL(path.join(root, 'src', 'templates', 'loader.ts')).href;
    expect(findBuiltinDir(moduleUrl, workspace)).toBe(builtinDir);
  });

  it('rejects a non-directory installed template asset', () => {
    const root = packageFixture();
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'templates'), 'not a directory');

    const moduleUrl = pathToFileURL(path.join(root, 'dist', 'src', 'index.js')).href;
    expect(findBuiltinDir(moduleUrl, root)).toBeNull();
  });

  it('does not use workspace templates for an unsupported module URL', () => {
    const root = packageFixture();
    fs.mkdirSync(path.join(root, 'src', 'templates', 'builtin'), { recursive: true });

    expect(findBuiltinDir('data:text/javascript,export{}', root)).toBeNull();
    expect(findBuiltinDir(pathToFileURL(path.join(root, 'other', 'loader.js')).href, root)).toBeNull();
  });
});
