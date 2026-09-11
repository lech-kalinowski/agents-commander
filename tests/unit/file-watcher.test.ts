import { describe, expect, it } from 'vitest';
import { isIgnoredWatchPath } from '../../src/file-manager/file-watcher.js';
import { LOG_DIR } from '../../src/utils/logger.js';
import path from 'node:path';

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

  it('ignores only the actual Commander runtime state directory and its descendants', () => {
    for (const target of [LOG_DIR, ...['debug.log', 'debug.log.1', 'debug.log.lock', 'config.json']
      .map((name) => path.join(LOG_DIR, name))]) {
      expect(isIgnoredWatchPath(target)).toBe(true);
    }
    expect(isIgnoredWatchPath(`${LOG_DIR}-backup/debug.log`)).toBe(false);
    expect(isIgnoredWatchPath(path.join('/project', path.basename(LOG_DIR), 'source.ts'))).toBe(false);
  });
});
