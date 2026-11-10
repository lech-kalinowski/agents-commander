import os from 'node:os';
import path from 'node:path';
import { resolveExecutablePath } from './command-resolution.js';

export interface ShellLaunchSpec {
  label: string;
  command: string;
  args: string[];
}

/** A shell executable, never a command string or a workspace-relative path. */
export function buildShellLaunchSpec(
  preferredShell: string | undefined = process.env.SHELL,
  loginShell: () => string | null = () => os.userInfo().shell,
  resolve: (command: string) => string | null = resolveExecutablePath,
): ShellLaunchSpec {
  let accountShell: string | null = null;
  try { accountShell = loginShell(); } catch { /* Some containers have no passwd entry. */ }
  for (const candidate of [preferredShell, accountShell, '/bin/sh']) {
    if (!candidate || !path.isAbsolute(candidate) || /[\0\r\n]/u.test(candidate)) continue;
    const command = resolve(candidate);
    if (command) return { label: `Shell (${path.basename(command)})`, command, args: ['-i'] };
  }
  throw new Error('No executable shell found. Set SHELL to an absolute executable path.');
}
