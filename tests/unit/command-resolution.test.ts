import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { resolveExecutablePath } from '../../src/utils/command-resolution.js';

vi.mock('node:fs', () => ({
  default: {
    accessSync: vi.fn(),
    constants: { X_OK: 1 },
    statSync: vi.fn(),
  },
}));

describe('resolveExecutablePath', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it('rejects unsafe command names', () => {
    expect(resolveExecutablePath('codex;rm -rf /')).toBeNull();
    expect(fs.accessSync).not.toHaveBeenCalled();
    expect(fs.statSync).not.toHaveBeenCalled();
  });

  it('finds executables by searching PATH entries directly', () => {
    process.env.PATH = '/missing/bin:/usr/local/bin';

    vi.mocked(fs.statSync).mockImplementation((filePath: string) => {
      if (filePath === '/usr/local/bin/codex') {
        return { isFile: () => true } as ReturnType<typeof fs.statSync>;
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    vi.mocked(fs.accessSync).mockImplementation((filePath: string) => {
      if (filePath !== '/usr/local/bin/codex') {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
    });

    expect(resolveExecutablePath('codex')).toBe('/usr/local/bin/codex');
  });
});
