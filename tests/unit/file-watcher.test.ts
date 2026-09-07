import { describe, expect, it } from 'vitest';
import { isIgnoredWatchPath } from '../../src/file-manager/file-watcher.js';

describe('file watcher ignores', () => {
  it('ignores generated and dependency directories at any depth', () => {
    expect(isIgnoredWatchPath('/project/node_modules/pkg/index.js')).toBe(true);
    expect(isIgnoredWatchPath('/project/packages/app/dist/index.js')).toBe(true);
    expect(isIgnoredWatchPath('/project/.git/HEAD')).toBe(true);
  });

  it('does not ignore similarly named source paths', () => {
    expect(isIgnoredWatchPath('/project/src/distribution/index.ts')).toBe(false);
    expect(isIgnoredWatchPath('/project/build-tools/config.ts')).toBe(false);
  });
});
