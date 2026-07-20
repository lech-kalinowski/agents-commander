import { watch, type FSWatcher } from 'chokidar';
import { appEvents } from '../utils/events.js';
import { logger } from '../utils/logger.js';
import path from 'node:path';

let watcher: FSWatcher | null = null;
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'build',
  '__pycache__',
]);

export function isIgnoredWatchPath(filePath: string): boolean {
  return path.resolve(filePath).split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part));
}

export function startWatching(rootPath: string, debounceMs = 100): void {
  if (watcher) {
    watcher.close();
  }

  watcher = watch(rootPath, {
    ignored: isIgnoredWatchPath,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: debounceMs, pollInterval: 50 },
  });

  const emit = (type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir', filePath: string) => {
    logger.debug(`File ${type}: ${filePath}`);
    appEvents.emit('file:changed', { path: filePath, type });
  };

  watcher
    .on('add', (p) => emit('add', p))
    .on('change', (p) => emit('change', p))
    .on('unlink', (p) => emit('unlink', p))
    .on('addDir', (p) => emit('addDir', p))
    .on('unlinkDir', (p) => emit('unlinkDir', p))
    .on('error', (err) => logger.error('Watcher error', err));
}

export function stopWatching(): void {
  watcher?.close();
  watcher = null;
}
