import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeWriteStream extends EventEmitter {
  write = vi.fn(() => true);
  end = vi.fn();
  destroy = vi.fn();
}

describe('logger', () => {
  afterEach(async () => {
    vi.doUnmock('node:fs');
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('stops file logging when the stream emits an error', async () => {
    const stream = new FakeWriteStream();
    const existsSync = vi.fn(() => true);
    const mkdirSync = vi.fn();
    const createWriteStream = vi.fn(() => stream);

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync,
        mkdirSync,
        createWriteStream,
        default: {
          ...actual,
          existsSync,
          mkdirSync,
          createWriteStream,
        },
      };
    });

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { logger } = await import('../../src/utils/logger.js');

    logger.debug('before stream failure');
    expect(stream.write).toHaveBeenCalledTimes(1);

    expect(() => {
      stream.emit('error', new Error('EPERM: operation not permitted'));
    }).not.toThrow();

    expect(() => logger.info('after stream failure')).not.toThrow();
    expect(createWriteStream).toHaveBeenCalledTimes(1);
    expect(stream.destroy).toHaveBeenCalledTimes(1);
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(stderrWrite.mock.calls[0]?.[0]).toContain('File logging disabled');

    logger.close();
  });

  it('does not throw when the log directory cannot be created', async () => {
    const existsSync = vi.fn(() => false);
    const mkdirSync = vi.fn(() => {
      throw new Error('EPERM: operation not permitted');
    });
    const createWriteStream = vi.fn();

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync,
        mkdirSync,
        createWriteStream,
        default: {
          ...actual,
          existsSync,
          mkdirSync,
          createWriteStream,
        },
      };
    });

    const { logger } = await import('../../src/utils/logger.js');

    expect(() => logger.error('directory creation failed')).not.toThrow();
    expect(createWriteStream).not.toHaveBeenCalled();

    logger.close();
  });
});
