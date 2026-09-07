import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listBuiltinTemplateFiles,
  resolveBuiltinTemplateDirectory,
  resolveCodexMicroBridgePath,
  resolveDemoAgentPath,
  resolvePtyHelperPath,
  runtimeAssetLookupForModule,
  type RuntimeAssetLookupOptions,
} from '../../src/utils/runtime-assets.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-commander-assets-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('runtime asset resolution', () => {
  it('resolves assets from an installed package layout without depending on cwd', () => {
    const root = temporaryDirectory();
    const entryPath = path.join(root, 'dist', 'bin', 'agents-commander.js');
    const helperPath = path.join(root, 'dist', 'agents', 'pty-helper.py');
    const microBridgePath = path.join(root, 'dist', 'hardware', 'codex-micro-bridge.py');
    const templatesPath = path.join(root, 'dist', 'templates');
    const demoPath = path.join(root, 'dist', 'demo', 'demo-agent.mjs');

    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.mkdirSync(path.dirname(microBridgePath), { recursive: true });
    fs.mkdirSync(templatesPath, { recursive: true });
    fs.mkdirSync(path.dirname(demoPath), { recursive: true });
    fs.writeFileSync(entryPath, '');
    fs.writeFileSync(helperPath, '#!/usr/bin/env python3\n');
    fs.writeFileSync(microBridgePath, '#!/usr/bin/env python3\n');
    fs.writeFileSync(path.join(templatesPath, 'z-last.md'), '# Last\n');
    fs.writeFileSync(path.join(templatesPath, 'a-first.md'), '# First\n');
    fs.writeFileSync(path.join(templatesPath, 'ignore.txt'), 'not a template\n');
    fs.writeFileSync(demoPath, '#!/usr/bin/env node\n');

    const options: RuntimeAssetLookupOptions = {
      mode: 'installed',
      packageRoot: root,
    };

    expect(resolvePtyHelperPath(options)).toBe(helperPath);
    expect(resolveCodexMicroBridgePath(options)).toBe(microBridgePath);
    expect(resolveBuiltinTemplateDirectory(options)).toBe(templatesPath);
    expect(listBuiltinTemplateFiles(templatesPath)).toEqual([
      path.join(templatesPath, 'a-first.md'),
      path.join(templatesPath, 'z-last.md'),
    ]);
    expect(resolveDemoAgentPath(options)).toBe(demoPath);
  });

  it('requires the PTY helper and demo asset to be readable regular files', () => {
    const root = temporaryDirectory();
    const entryPath = path.join(root, 'dist', 'bin', 'agents-commander.js');
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'agents', 'pty-helper.py'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'hardware', 'codex-micro-bridge.py'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'demo', 'demo-agent.mjs'), { recursive: true });

    const options: RuntimeAssetLookupOptions = {
      mode: 'installed',
      packageRoot: root,
    };

    expect(resolvePtyHelperPath(options)).toBeNull();
    expect(resolveCodexMicroBridgePath(options)).toBeNull();
    expect(resolveDemoAgentPath(options)).toBeNull();
  });

  it('resolves every development asset only from an explicit source root', () => {
    const root = temporaryDirectory();
    const helperPath = path.join(root, 'src', 'agents', 'pty-helper.py');
    const microBridgePath = path.join(root, 'src', 'hardware', 'codex-micro-bridge.py');
    const templatesPath = path.join(root, 'src', 'templates', 'builtin');
    const demoPath = path.join(root, 'src', 'demo', 'demo-agent.mjs');
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.mkdirSync(path.dirname(microBridgePath), { recursive: true });
    fs.mkdirSync(templatesPath, { recursive: true });
    fs.mkdirSync(path.dirname(demoPath), { recursive: true });
    fs.writeFileSync(helperPath, '#!/usr/bin/env python3\n');
    fs.writeFileSync(microBridgePath, '#!/usr/bin/env python3\n');
    fs.writeFileSync(path.join(templatesPath, 'source.md'), '# Source\n');
    fs.writeFileSync(demoPath, '#!/usr/bin/env node\n');

    const sourceLookup: RuntimeAssetLookupOptions = {
      mode: 'source',
      sourceRoot: root,
    };
    expect(resolvePtyHelperPath(sourceLookup)).toBe(helperPath);
    expect(resolveCodexMicroBridgePath(sourceLookup)).toBe(microBridgePath);
    expect(resolveBuiltinTemplateDirectory(sourceLookup)).toBe(templatesPath);
    expect(resolveDemoAgentPath(sourceLookup)).toBe(demoPath);
  });

  it('derives source and installed modes from the executing module rather than cwd', () => {
    const root = temporaryDirectory();
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'agents-commander', version: '1.0.0' }),
    );

    expect(runtimeAssetLookupForModule(
      pathToFileURL(path.join(root, 'src', 'utils', 'runtime-assets.js')).href,
    )).toEqual({
      mode: 'source',
      sourceRoot: root,
    });
    expect(runtimeAssetLookupForModule(
      pathToFileURL(path.join(root, 'dist', 'chunks', 'runtime-assets.js')).href,
    )).toEqual({
      mode: 'installed',
      packageRoot: root,
    });
    expect(runtimeAssetLookupForModule(
      pathToFileURL(path.join(root, 'dist', 'src', 'index.js')).href,
    )).toEqual({
      mode: 'installed',
      packageRoot: root,
    });
    expect(() => runtimeAssetLookupForModule(
      pathToFileURL(path.join(root, 'other', 'runtime-assets.js')).href,
    )).toThrow('outside the supported source and installed layouts');
  });

  it('does not fall back to workspace-controlled executable assets in installed mode', () => {
    const root = temporaryDirectory();
    const packageRoot = path.join(root, 'node_modules', 'agents-commander');
    const workspaceRoot = path.join(root, 'workspace');
    const workspaceHelper = path.join(workspaceRoot, 'src', 'agents', 'pty-helper.py');
    const workspaceDemo = path.join(workspaceRoot, 'src', 'demo', 'demo-agent.js');
    fs.mkdirSync(path.dirname(workspaceHelper), { recursive: true });
    fs.mkdirSync(path.dirname(workspaceDemo), { recursive: true });
    fs.writeFileSync(workspaceHelper, '#!/usr/bin/env python3\n');
    fs.writeFileSync(workspaceDemo, '#!/usr/bin/env node\n');

    const installedLookup = {
      mode: 'installed',
      packageRoot,
      // Extra legacy fields model an older caller. They must never affect lookup.
      cwd: workspaceRoot,
      homeDir: workspaceRoot,
    } as RuntimeAssetLookupOptions;

    expect(resolvePtyHelperPath(installedLookup)).toBeNull();
    expect(resolveCodexMicroBridgePath(installedLookup)).toBeNull();
    expect(resolveDemoAgentPath(installedLookup)).toBeNull();
  });

  it('rejects relative roots and symlinked executable assets', () => {
    const root = temporaryDirectory();
    const externalHelper = path.join(root, 'workspace-helper.py');
    const helperPath = path.join(root, 'package', 'dist', 'agents', 'pty-helper.py');
    const bridgePath = path.join(root, 'package', 'dist', 'hardware', 'codex-micro-bridge.py');
    fs.writeFileSync(externalHelper, '#!/usr/bin/env python3\n');
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
    fs.symlinkSync(externalHelper, helperPath);
    fs.symlinkSync(externalHelper, bridgePath);

    expect(resolvePtyHelperPath({
      mode: 'installed',
      packageRoot: path.join(root, 'package'),
    })).toBeNull();
    expect(resolveCodexMicroBridgePath({
      mode: 'installed',
      packageRoot: path.join(root, 'package'),
    })).toBeNull();
    expect(resolvePtyHelperPath({
      mode: 'installed',
      packageRoot: 'relative-package-root',
    })).toBeNull();
    expect(resolveCodexMicroBridgePath({
      mode: 'installed',
      packageRoot: 'relative-package-root',
    })).toBeNull();
  });
});
