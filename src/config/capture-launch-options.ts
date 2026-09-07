import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { CaptureMode } from '../capture/types.js';

export interface CaptureCliOptions {
  capture?: string;
  captureProject?: string;
  captureDir?: string;
}

export interface CaptureLaunchOptions {
  mode: CaptureMode;
  projectId: string;
  rootDirectory?: string;
}

/** Canonicalize existing ancestors without creating a user-selected output. */
function canonicalProspectivePath(value: string): string {
  let existing = path.resolve(value);
  const suffix: string[] = [];
  while (true) {
    try { return path.join(fs.realpathSync(existing), ...suffix.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      suffix.push(path.basename(existing));
      existing = parent;
    }
  }
}

/** Capture consent is launch-only and is never read from or saved to config. */
export function resolveCaptureLaunchOptions(
  options: CaptureCliOptions,
  workingDirectory: string,
): CaptureLaunchOptions {
  const mode = options.capture ?? 'off';
  if (mode !== 'off' && mode !== 'metadata' && mode !== 'protocol') {
    throw new Error('Invalid capture mode. Expected off, metadata, or protocol.');
  }
  if (mode === 'off') {
    if (options.captureProject !== undefined || options.captureDir !== undefined) {
      throw new Error('--capture-project and --capture-dir require --capture metadata or protocol.');
    }
    return { mode: 'off', projectId: 'disabled' };
  }
  if (!options.captureProject || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(options.captureProject)) {
    throw new Error('--capture-project requires an opaque project-family ID (1-64 letters, digits, _ or -). Reuse it across related runs.');
  }
  const rootDirectory = options.captureDir === undefined ? undefined : path.resolve(options.captureDir);
  const effectiveRoot = rootDirectory ?? path.join(os.homedir(), '.agents-commander', 'captures');
  const relative = path.relative(canonicalProspectivePath(workingDirectory), canonicalProspectivePath(effectiveRoot));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Capture storage must be outside the working project; choose --capture-dir elsewhere to avoid committing private recordings.');
  }
  return { mode, projectId: options.captureProject, rootDirectory };
}
