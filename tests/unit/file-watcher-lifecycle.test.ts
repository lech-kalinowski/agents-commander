import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { MAX_ACTIVE_PANELS } from '../../src/panel-limits.js';

const fixture = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  watch: fixture.watch,
}));
vi.mock('../../src/utils/logger.js', () => ({
  LOG_DIR: '/commander-test-state',
  logger: { debug: vi.fn(), error: vi.fn() },
}));

import { startWatching, stopWatching } from '../../src/file-manager/file-watcher.js';
import { appEvents } from '../../src/utils/events.js';
import { logger } from '../../src/utils/logger.js';

interface WatchFixture {
  directory: string;
  handle: EventEmitter & { close: ReturnType<typeof vi.fn> };
  callback: (event: string, filename: string | null) => void;
}
let handles: WatchFixture[];
const changed = vi.fn();
const failed = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  handles = [];
  fixture.watch.mockImplementation((directory, _options, callback) => {
    const handle = Object.assign(new EventEmitter(), { close: vi.fn() });
    handles.push({ directory, handle, callback });
    return handle;
  });
  appEvents.on('file:changed', changed);
  appEvents.on('file:watch-error', failed);
});

afterEach(() => {
  stopWatching();
  appEvents.removeListener('file:changed', changed);
  appEvents.removeListener('file:watch-error', failed);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('bounded shallow file watcher lifecycle', () => {
  it('uses one native non-recursive watch per normalized root, capped at panel capacity', () => {
    startWatching(['/project', '/project/child/..', ...Array.from(
      { length: MAX_ACTIVE_PANELS + 10 }, (_, index) => `/project-${index}`,
    )]);
    expect(fixture.watch).toHaveBeenCalledTimes(MAX_ACTIVE_PANELS);
    for (const call of fixture.watch.mock.calls) {
      expect(call[1]).toEqual({ recursive: false, persistent: true });
    }
    expect(handles.filter((item) => item.directory === '/project')).toHaveLength(1);
  });

  it('retains unchanged roots, closes removed roots, and ignores their stale callbacks', () => {
    startWatching(['/project-a', '/project-b'], 50);
    const [first, removed] = handles;
    removed.callback('change', 'pending.txt');
    startWatching(['/project-a', '/project-c'], 50);
    expect(first.handle.close).not.toHaveBeenCalled();
    expect(removed.handle.close).toHaveBeenCalledOnce();
    expect(fixture.watch).toHaveBeenCalledTimes(3);
    removed.callback('change', 'stale.txt');
    first.callback('rename', 'current.txt');
    vi.advanceTimersByTime(50);
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({ path: '/project-a/current.txt', type: 'change' });
  });

  it('coalesces bursts and ignores runtime log paths even when their parent is watched', () => {
    startWatching('/', 100);
    const root = handles[0];
    root.callback('change', 'commander-test-state');
    vi.advanceTimersByTime(100);
    expect(changed).not.toHaveBeenCalled();
    for (let count = 0; count < 200; count++) root.callback('rename', 'project.txt');
    vi.advanceTimersByTime(100);
    expect(changed).toHaveBeenCalledOnce();
    expect(logger.debug).not.toHaveBeenCalled();
    startWatching(['/commander-test-state', '/commander-test-state/config.json']);
    expect(fixture.watch).toHaveBeenCalledOnce();
    expect(root.handle.close).toHaveBeenCalledOnce();
  });

  it('does not write logs for events with missing filenames that may originate from runtime state', () => {
    startWatching('/', 50);
    const root = handles[0];
    for (let count = 0; count < 50; count++) root.callback('change', null);
    vi.advanceTimersByTime(50);
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({ path: '/', type: 'change' });
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each(['EMFILE', 'ENOSPC', 'EACCES'])('closes %s failures once and stops retry/log storms', (code) => {
    startWatching('/project', 50);
    const item = handles[0];
    item.callback('change', 'pending.txt');
    const error = Object.assign(new Error('watch failed'), { code });
    item.handle.emit('error', error);
    item.handle.emit('error', error);
    item.callback('change', 'stale.txt');
    startWatching('/project', 50);
    vi.advanceTimersByTime(1000);
    expect(item.handle.close).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith({
      path: '/project', code,
      message: expect.stringContaining('Ctrl+R'),
    });
    expect(changed).not.toHaveBeenCalled();
    expect(fixture.watch).toHaveBeenCalledOnce();
    startWatching([]);
    startWatching('/project');
    expect(fixture.watch).toHaveBeenCalledTimes(2);
  });

  it('reports synchronous setup failure once without preventing other roots from being watched', () => {
    fixture.watch.mockImplementationOnce(() => {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    });
    startWatching(['/missing', '/project']);
    expect(failed).toHaveBeenCalledOnce();
    expect(handles.map((item) => item.directory)).toEqual(['/project']);
    startWatching(['/missing', '/project']);
    expect(fixture.watch).toHaveBeenCalledTimes(2);
  });

  it('closes all owned handles and cancels queued and late events on stop', () => {
    startWatching(['/project-a', '/project-b'], 50);
    for (const item of handles) item.callback('change', null);
    stopWatching();
    stopWatching();
    for (const item of handles) {
      expect(item.handle.close).toHaveBeenCalledOnce();
      item.callback('rename', path.basename(item.directory));
      item.handle.emit('error', new Error('late error'));
    }
    vi.advanceTimersByTime(1000);
    expect(changed).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
