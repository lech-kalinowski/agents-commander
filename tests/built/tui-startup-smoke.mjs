#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

// Called by packed-install-smoke with its private, owned synthetic home. No
// provider, shell agent, hardware action, user configuration or real home scan.
const [packageRoot, workspace] = process.argv.slice(2).map((value) => path.resolve(value));
assert.ok(packageRoot && workspace, 'Supply installed package root and owned workspace');
const { VTerm, loadTemplates } = await import(pathToFileURL(path.join(packageRoot, 'dist/src/index.js')).href);
const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const tree = path.join(workspace, 'large-tree');
await fs.mkdir(tree, { recursive: true });
// More descendants than the child's descriptor limit: recursive watching is a
// regression even though only a few directory entries are visible at startup.
for (let index = 0; index < 180; index++) {
  const directory = path.join(tree, `child-${String(index).padStart(3, '0')}`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'nested.txt'), 'synthetic watcher fixture\n');
}

const width = 150;
const height = 54;
const term = new VTerm(width, height);
const decoder = new StringDecoder('utf8');
const limitDescriptors = [
  'import os, resource, sys',
  'soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)',
  'limit = 128 if hard == resource.RLIM_INFINITY else min(128, hard)',
  'resource.setrlimit(resource.RLIMIT_NOFILE, (limit, hard))',
  'os.execv(sys.executable, [sys.executable, *sys.argv[1:]])',
].join('\n');
const child = spawn('python3', [
  '-c', limitDescriptors,
  path.join(packageRoot, 'dist/agents/pty-helper.py'), '--',
  process.execPath, path.join(packageRoot, 'dist/bin/agents-commander.js'),
], {
  cwd: workspace,
  env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(width), LINES: String(height) },
  stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
});
let stderr = '';
let spawnError;
child.once('error', (error) => { spawnError = error; });
child.stdout.on('data', (data) => term.write(decoder.write(data)));
child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-8192); });
// Cleanup may race a helper that has already closed its control pipe.
child.stdio[3].on('error', () => {});
const closed = once(child, 'close');
const screen = () => term.getGridPlainLines().join('\n');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.equal(spawnError, undefined);
    assert.equal(child.exitCode, null, `CLI exited during ${label}: ${stderr}`);
    assert.ok(Date.now() < deadline, `${label} timed out\n${screen()}\n${stderr}`);
    await delay(20);
  }
}
async function key(bytes, predicate, label) {
  child.stdin.write(bytes);
  await waitFor(predicate, label);
}
const normalPanels = () => !screen().includes('Multi-Agent Terminal Manager')
  && !screen().includes('Launch Agent (F2)')
  && !screen().includes('Prompt Templates (Ctrl+B)')
  && !screen().includes('Panel Navigator (F11)');

try {
  await waitFor(() => screen().includes(`v${metadata.version}`)
    && screen().includes('Multi-Agent Terminal Manager'), 'normal welcome');
  assert.match(screen(), /Browse 121 prompt templates/u);
  assert.equal(loadTemplates().filter((template) => template.source === 'builtin').length, 121);
  await key(' ', normalPanels, 'Space dismisses welcome');
  await key('\t', () => /P2\s+\|\s+Position #2/u.test(screen()), 'Tab focuses second panel');
  await key('\x1b[B', () => /large-tree/u.test(term.getGridPlainLines().at(-2)), 'Down selects a directory');
  await key('\x1bOQ', () => screen().includes('Launch Agent (F2)'), 'F2 opens agent picker');
  child.stdin.write('\x1b[B');
  await delay(60);
  await key('\x1b', normalPanels, 'Esc closes agent picker');
  await key('\x02', () => screen().includes('Prompt Templates (Ctrl+B)'), 'Ctrl+B opens installed templates');
  assert.doesNotMatch(screen(), /No templates found/u);
  await key('\x1b', normalPanels, 'Esc closes template browser');
  await key('\x1bOR', () => /3 panels/u.test(screen()), 'F3 creates a panel');
  await key('\x1bOS', () => /F4 Back/u.test(screen()), 'F4 fullscreen');
  await key('\x1bOS', () => !/F4 Back/u.test(screen()), 'F4 restores the grid');
  await key('\x1b[23~', () => screen().includes('Panel Navigator (F11)'), 'F11 opens navigator');
  await key('\x1b', normalPanels, 'Esc closes navigator');
  // Native directory events must still refresh the UI after bounded watching.
  await fs.writeFile(path.join(workspace, 'refresh-proof.txt'), 'synthetic refresh\n');
  await waitFor(() => screen().includes('refresh-proof.txt'), 'live shallow file refresh');
  await key('\x1b[21~', () => screen().includes('Exit Agents Commander?'), 'F10 opens quit confirmation');
  child.stdin.write('y');
  const result = await Promise.race([
    closed,
    delay(5000).then(() => { throw new Error('CLI did not exit after keyboard confirmation'); }),
  ]);
  assert.equal(result[0], 0, stderr);
  assert.doesNotMatch(stderr, /EMFILE|ENOSPC|too many open files/u);
  let log = '';
  try { log = await fs.readFile(path.join(workspace, '.agents-commander/debug.log'), 'utf8'); } catch {}
  assert.doesNotMatch(log, /EMFILE|ENOSPC|Watcher error|File watcher stopped/u);
  console.log('Packed TUI keyboard smoke passed: normal welcome, 121 templates, Space/Tab/arrows/F2/Esc/Ctrl+B/F3/F4/F11/F10, live refresh and clean quit under a 128-descriptor limit.');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([closed.catch(() => {}), delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) {
      // Ask the still-running helper to kill its owned PTY process group first;
      // killing only the helper could orphan the unresponsive CLI under test.
      child.stdio[3].write('signal KILL\n');
      child.stdin.end();
      await Promise.race([closed.catch(() => {}), delay(2000)]);
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}
