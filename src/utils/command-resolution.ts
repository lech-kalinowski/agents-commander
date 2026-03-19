import fs from 'node:fs';
import path from 'node:path';

const SAFE_COMMAND_RE = /^[a-zA-Z0-9_.-]+$/;
const UNSAFE_PATH_RE = /[\0\r\n;&|`$<>"']/;
function isExecutableFile(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    if (process.platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function appendCommandVariants(candidates: Set<string>, dir: string, command: string): void {
  if (!dir) return;

  if (process.platform === 'win32') {
    const pathext = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean);

    if (path.extname(command)) {
      candidates.add(path.join(dir, command));
      return;
    }

    candidates.add(path.join(dir, command));
    for (const ext of pathext) {
      candidates.add(path.join(dir, `${command}${ext.toLowerCase()}`));
      candidates.add(path.join(dir, `${command}${ext.toUpperCase()}`));
    }
    return;
  }

  candidates.add(path.join(dir, command));
}

function buildSearchDirectories(): string[] {
  const directories = new Set<string>();

  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed) directories.add(trimmed);
  }

  directories.add('/usr/local/bin');
  directories.add('/opt/homebrew/bin');

  const home = process.env.HOME;
  if (home) {
    directories.add(path.join(home, '.local', 'bin'));
    directories.add(path.join(home, '.npm-global', 'bin'));
    directories.add(path.join(home, '.bun', 'bin'));

    const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
    directories.add(path.join(nvmDir, 'versions', 'node', process.version, 'bin'));
  }

  return [...directories];
}

export function resolveExecutablePath(command: string): string | null {
  if (!command) return null;

  if (path.isAbsolute(command)) {
    return isExecutableFile(command) ? command : null;
  }

  if (command.includes(path.sep) || (path.sep !== '/' && command.includes('/'))) {
    if (UNSAFE_PATH_RE.test(command)) return null;
    const resolvedPath = path.resolve(command);
    return isExecutableFile(resolvedPath) ? resolvedPath : null;
  }

  if (!SAFE_COMMAND_RE.test(command)) return null;

  const candidates = new Set<string>();
  for (const dir of buildSearchDirectories()) {
    appendCommandVariants(candidates, dir, command);
  }

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) return candidate;
  }

  return null;
}
