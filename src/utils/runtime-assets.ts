import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RuntimeAssetLookupOptions =
  | Readonly<{
    mode: 'installed';
    packageRoot: string;
  }>
  | Readonly<{
    mode: 'source';
    sourceRoot: string;
  }>;

const PACKAGE_NAME = 'agents-commander';

/**
 * Select the only asset layout that is valid for the module being executed.
 * The decision is based on the module path, never the process working directory.
 */
export function runtimeAssetLookupForModule(moduleUrl: string): RuntimeAssetLookupOptions {
  let modulePath: string;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch (error) {
    throw new Error(
      'Runtime assets can only be resolved for a local source or installed module',
      { cause: error },
    );
  }

  let currentDirectory = path.dirname(modulePath);
  let packageRoot: string | null = null;
  while (true) {
    try {
      const packageMetadata = JSON.parse(
        fs.readFileSync(path.join(currentDirectory, 'package.json'), 'utf8'),
      ) as { name?: unknown };
      if (packageMetadata.name === PACKAGE_NAME) {
        packageRoot = currentDirectory;
        break;
      }
    } catch {
      // Keep walking toward the filesystem root.
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  if (packageRoot) {
    const relativeModulePath = path.relative(packageRoot, modulePath);
    if (
      relativeModulePath === 'dist'
      || relativeModulePath.startsWith(`dist${path.sep}`)
    ) {
      return { mode: 'installed', packageRoot };
    }
    if (
      relativeModulePath === 'src'
      || relativeModulePath.startsWith(`src${path.sep}`)
    ) {
      return { mode: 'source', sourceRoot: packageRoot };
    }
  }

  throw new Error('Runtime module is outside the supported source and installed layouts');
}

function isReadableRegularFile(filePath: string): boolean {
  try {
    if (!fs.lstatSync(filePath).isFile()) return false;
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function isReadableDirectory(directoryPath: string): boolean {
  try {
    if (!fs.lstatSync(directoryPath).isDirectory()) return false;
    fs.accessSync(directoryPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function lookupRoot(options: RuntimeAssetLookupOptions): string | null {
  const root = options.mode === 'installed' ? options.packageRoot : options.sourceRoot;
  return path.isAbsolute(root) ? path.normalize(root) : null;
}

export function resolvePtyHelperPath(options: RuntimeAssetLookupOptions): string | null {
  const root = lookupRoot(options);
  if (!root) return null;
  const helperPath = options.mode === 'installed'
    ? path.join(root, 'dist', 'agents', 'pty-helper.py')
    : path.join(root, 'src', 'agents', 'pty-helper.py');
  return isReadableRegularFile(helperPath) ? helperPath : null;
}

export function resolveCodexMicroBridgePath(
  options: RuntimeAssetLookupOptions,
): string | null {
  const root = lookupRoot(options);
  if (!root) return null;
  const bridgePath = options.mode === 'installed'
    ? path.join(root, 'dist', 'hardware', 'codex-micro-bridge.py')
    : path.join(root, 'src', 'hardware', 'codex-micro-bridge.py');
  return isReadableRegularFile(bridgePath) ? bridgePath : null;
}

export function resolveBuiltinTemplateDirectory(
  options: RuntimeAssetLookupOptions,
): string | null {
  const root = lookupRoot(options);
  if (!root) return null;
  const templateDirectory = options.mode === 'installed'
    ? path.join(root, 'dist', 'templates')
    : path.join(root, 'src', 'templates', 'builtin');
  return isReadableDirectory(templateDirectory) ? templateDirectory : null;
}

export function listBuiltinTemplateFiles(directoryPath: string): string[] {
  if (!isReadableDirectory(directoryPath)) return [];
  try {
    return fs.readdirSync(directoryPath)
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(directoryPath, name))
      .filter(isReadableRegularFile)
      .sort();
  } catch {
    return [];
  }
}

export function resolveDemoAgentPath(options: RuntimeAssetLookupOptions): string | null {
  const root = lookupRoot(options);
  if (!root) return null;
  const demoDirectory = options.mode === 'installed'
    ? path.join(root, 'dist', 'demo')
    : path.join(root, 'src', 'demo');
  const candidates = [
    path.join(demoDirectory, 'demo-agent.mjs'),
    path.join(demoDirectory, 'demo-agent.js'),
  ];
  return candidates.find(isReadableRegularFile) ?? null;
}
