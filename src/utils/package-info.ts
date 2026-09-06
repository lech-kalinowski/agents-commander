import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageInfo {
  name: string;
  version: string;
}

const FALLBACK_INFO: PackageInfo = {
  name: 'agents-commander',
  version: 'development',
};

let cachedInfo: PackageInfo | null = null;

export function getPackageInfo(moduleUrl = import.meta.url): PackageInfo {
  if (moduleUrl === import.meta.url && cachedInfo) return cachedInfo;

  const candidates: string[] = [];
  try {
    let currentDirectory = path.dirname(fileURLToPath(moduleUrl));
    while (true) {
      candidates.push(path.join(currentDirectory, 'package.json'));
      const parentDirectory = path.dirname(currentDirectory);
      if (parentDirectory === currentDirectory) break;
      currentDirectory = parentDirectory;
    }
  } catch {
    // Use the fallback below.
  }

  for (const packagePath of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      if (
        parsed.name === FALLBACK_INFO.name
        && typeof parsed.version === 'string'
        && parsed.version.length > 0
      ) {
        const info = { name: parsed.name, version: parsed.version };
        if (moduleUrl === import.meta.url) cachedInfo = info;
        return info;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return { ...FALLBACK_INFO };
}

export function getPackageVersion(): string {
  return getPackageInfo().version;
}
