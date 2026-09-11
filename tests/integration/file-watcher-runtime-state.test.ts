import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FSWatcher } from 'node:fs';

const fixture = vi.hoisted(() => ({
  logDirectory: '',
  logFile: '',
  watchers: [] as FSWatcher[],
}));

vi.mock('../../src/utils/logger.js', () => ({
  get LOG_DIR() { return fixture.logDirectory; },
  logger: {
    debug: vi.fn((message: string) => appendFileSync(fixture.logFile, `${message}\n`)),
    error: vi.fn(),
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    watch: (...args: Parameters<typeof original.watch>) => {
      const watcher = original.watch(...args);
      fixture.watchers.push(watcher);
      return watcher;
    },
  };
});

import { startWatching, stopWatching } from '../../src/file-manager/file-watcher.js';
import { appEvents } from '../../src/utils/events.js';
import { logger } from '../../src/utils/logger.js';

let temporaryRoot: string | undefined;
let onChange: (() => void) | undefined;

afterEach(async () => {
  stopWatching();
  for (const watcher of fixture.watchers.splice(0)) watcher.close();
  if (onChange) appEvents.removeListener('file:changed', onChange);
  onChange = undefined;
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
  vi.clearAllMocks();
});

describe('watching a parent of Commander runtime state', () => {
  it('refreshes project files without observing and relogging its own state writes', async () => {
    // Deliberately put runtime state under the watched directory without
    // changing HOME or reading/modifying the real user configuration.
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-watch-state-'));
    fixture.logDirectory = path.join(temporaryRoot, 'private-runtime');
    fixture.logFile = path.join(fixture.logDirectory, 'debug.log');
    await fs.mkdir(fixture.logDirectory);
    await fs.writeFile(fixture.logFile, 'initial log\n');
    const sourceFile = path.join(temporaryRoot, 'source.txt');
    await fs.writeFile(sourceFile, 'initial source\n');
    onChange = vi.fn();
    appEvents.on('file:changed', onChange);

    startWatching(temporaryRoot, 50);
    expect(fixture.watchers).toHaveLength(1);

    await fs.appendFile(sourceFile, 'changed source\n');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(logger.debug).not.toHaveBeenCalled();
    expect(await fs.readFile(fixture.logFile, 'utf8')).toBe('initial log\n');

    // Cover ordinary logging, rotation, lock-file creation and configuration
    // writes after readiness, not just ignoreInitial startup suppression.
    await fs.appendFile(fixture.logFile, 'another log line\n');
    await fs.writeFile(path.join(fixture.logDirectory, 'debug.log.1'), 'rotated\n');
    await fs.writeFile(path.join(fixture.logDirectory, 'debug.log.lock'), 'lock\n');
    await fs.writeFile(path.join(fixture.logDirectory, 'config.json'), '{}\n');
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('never logs notifications from a symlink alias of runtime state', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-watch-alias-'));
    fixture.logDirectory = path.join(temporaryRoot, 'private-runtime');
    fixture.logFile = path.join(fixture.logDirectory, 'debug.log');
    await fs.mkdir(fixture.logDirectory);
    await fs.writeFile(fixture.logFile, 'initial log\n');
    const alias = path.join(temporaryRoot, 'state-alias');
    await fs.symlink(fixture.logDirectory, alias, 'dir');
    onChange = vi.fn();
    appEvents.on('file:changed', onChange);
    startWatching(alias, 50);
    expect(fixture.watchers).toHaveLength(1);

    // The alias deliberately bypasses the lexical LOG_DIR ignore check.
    // Actual runtime logging may cause a refresh, but the watcher must not
    // append its own log entry and turn that notification into a feedback loop.
    await fs.appendFile(fixture.logFile, 'external log write\n');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const settledEvents = vi.mocked(onChange).mock.calls.length;
    expect(await fs.readFile(fixture.logFile, 'utf8')).toBe('initial log\nexternal log write\n');
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(onChange).toHaveBeenCalledTimes(settledEvents);
    expect(await fs.readFile(fixture.logFile, 'utf8')).toBe('initial log\nexternal log write\n');
  });

  it('uses one handle for a deep tree and watches another directory only when requested', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-watch-depth-'));
    fixture.logDirectory = path.join(temporaryRoot, 'private-runtime');
    fixture.logFile = path.join(fixture.logDirectory, 'debug.log');
    await fs.mkdir(fixture.logDirectory);
    await fs.writeFile(fixture.logFile, 'initial log\n');
    let deepest = temporaryRoot;
    for (let level = 0; level < 24; level++) {
      deepest = path.join(deepest, `level-${level}`);
      await fs.mkdir(deepest);
      await Promise.all(Array.from({ length: 8 }, (_, file) =>
        fs.writeFile(path.join(deepest, `entry-${file}.txt`), 'initial\n')));
    }
    onChange = vi.fn();
    appEvents.on('file:changed', onChange);
    startWatching(temporaryRoot, 30);
    expect(fixture.watchers).toHaveLength(1);
    await fs.appendFile(path.join(deepest, 'entry-0.txt'), 'not watched yet\n');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onChange).not.toHaveBeenCalled();

    startWatching([temporaryRoot, deepest, temporaryRoot], 30);
    expect(fixture.watchers).toHaveLength(2);
    await fs.appendFile(path.join(deepest, 'entry-0.txt'), 'now watched\n');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 });

    startWatching(temporaryRoot, 30);
    await fs.appendFile(path.join(deepest, 'entry-0.txt'), 'no longer watched\n');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
