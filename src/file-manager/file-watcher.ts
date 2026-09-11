import { watch, type FSWatcher } from 'node:fs';
import { appEvents } from '../utils/events.js';
import { logger, LOG_DIR } from '../utils/logger.js';
import path from 'node:path';
import { MAX_ACTIVE_PANELS } from '../panel-limits.js';

interface DirectoryWatch {
  directory: string;
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
}

const watchers = new Map<string, DirectoryWatch>();
let debounce = 100;
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'build',
  '__pycache__',
]);

export function isIgnoredWatchPath(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const relativeToState = path.relative(LOG_DIR, resolvedPath);
  // A launch from the user's home can otherwise observe its own debug log,
  // rotation and lock writes, producing another log entry for each one.
  const isRuntimeState = relativeToState === ''
    || (relativeToState !== '..'
      && !relativeToState.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativeToState));
  return isRuntimeState
    || resolvedPath.split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part));
}

function closeWatch(state: DirectoryWatch): void {
  state.closed = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  const watcher = state.watcher;
  state.watcher = null;
  try { watcher?.close(); } catch { /* The underlying handle may already be closed. */ }
}

function failWatch(state: DirectoryWatch, error: unknown): void {
  if (state.closed || watchers.get(state.directory) !== state) return;
  closeWatch(state);
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'WATCH_FAILED';
  const message = 'Automatic file refresh stopped for this directory; use Ctrl+R to refresh manually.';
  logger.error(`File watcher stopped (${code}): ${state.directory}`);
  appEvents.emit('file:watch-error', { path: state.directory, code, message });
}

/**
 * Reconcile shallow watches for the current file-panel directories. One native
 * handle per distinct directory, never a recursive scan of a home/project tree.
 * Failed roots stay closed until removed or stopWatching() resets ownership.
 */
export function startWatching(rootPaths: string | readonly string[], debounceMs = 100): void {
  debounce = Number.isFinite(debounceMs) ? Math.max(0, Math.min(60_000, debounceMs)) : 100;
  const requested = typeof rootPaths === 'string' ? [rootPaths] : rootPaths;
  const directories = new Set<string>();
  for (const rootPath of requested) {
    const directory = path.resolve(rootPath);
    if (!isIgnoredWatchPath(directory)) directories.add(directory);
    if (directories.size >= MAX_ACTIVE_PANELS) break;
  }

  for (const [directory, state] of watchers) {
    if (directories.has(directory)) continue;
    watchers.delete(directory);
    closeWatch(state);
  }

  for (const directory of directories) {
    if (watchers.has(directory)) continue;
    const state: DirectoryWatch = { directory, watcher: null, timer: null, closed: false };
    watchers.set(directory, state);
    try {
      state.watcher = watch(directory, { recursive: false, persistent: true }, (_eventType, filename) => {
        if (state.closed || watchers.get(directory) !== state) return;
        const name = filename?.toString();
        // Some macOS notifications name the watched directory itself, and
        // native notifications may omit names entirely. Refresh that root.
        const changedPath = name && name !== path.basename(directory)
          ? path.resolve(directory, name)
          : directory;
        if (isIgnoredWatchPath(changedPath)) return;
        // Native event kinds differ across platforms. Directory contents are
        // re-read on either rename or change; consumers need no guessed stat.
        if (state.timer) return;
        state.timer = setTimeout(() => {
          state.timer = null;
          if (state.closed || watchers.get(directory) !== state) return;
          // Never log successful notifications: missing names or a symlink
          // alias of LOG_DIR can hide log-origin events from lexical filters.
          // Logging those events would create another event indefinitely.
          appEvents.emit('file:changed', { path: changedPath, type: 'change' });
        }, debounce);
      });
      state.watcher.on('error', (error) => failWatch(state, error));
    } catch (error) {
      failWatch(state, error);
    }
  }
}

export function stopWatching(): void {
  const previous = [...watchers.values()];
  watchers.clear();
  for (const state of previous) closeWatch(state);
}
