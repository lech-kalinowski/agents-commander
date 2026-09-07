#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTUP_TIMEOUT_MS = 25_000;
const OUTPUT_LIMIT_BYTES = 64 * 1024;
const QUIET_PERIOD_MS = 250;
const TERMINATION_GRACE_MS = 1_500;
const FORCE_KILL_GRACE_MS = 1_000;

assert.ok(process.platform === 'darwin' || process.platform === 'linux', 'Watch smoke requires macOS or Linux/WSL2');
assert.ok(process.env.npm_execpath && path.isAbsolute(process.env.npm_execpath), 'Run this smoke check through npm run test:dev');
assert.ok((await fs.stat(process.env.npm_execpath)).isFile(), 'npm_execpath must identify the invoking npm CLI');

// Run the real public development script, including its runtime-asset hook.
// detached creates a new POSIX process group containing only this test's npm,
// tsup, compiler and hook children. Never enumerate or signal other sessions.
const child = spawn(process.execPath, [process.env.npm_execpath, 'run', 'dev'], {
  cwd: repositoryRoot,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  },
});

let output = '';
let outputBytes = 0;
let lastOutputAt = Date.now();
let failure;
let closed = false;
let closeDescription = '';
const spawnedGroup = child.pid;
const closedPromise = new Promise((resolve) => {
  child.once('close', (code, signal) => {
    closed = true;
    closeDescription = signal ? `signal ${signal}` : `code ${code}`;
    resolve();
  });
});
child.once('error', (error) => { failure = error; });
const collect = (chunk) => {
  if (outputBytes > OUTPUT_LIMIT_BYTES) return;
  outputBytes += Buffer.byteLength(chunk);
  if (outputBytes > OUTPUT_LIMIT_BYTES) {
    failure = new Error('Development build exceeded the bounded output budget');
    return;
  }
  output += chunk;
  lastOutputAt = Date.now();
};
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', collect);
child.stderr.on('data', collect);

const interrupted = (signal) => { failure = new Error(`Development smoke interrupted by ${signal}`); };
const onSigint = () => interrupted('SIGINT');
const onSigterm = () => interrupted('SIGTERM');
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);

function groupExists() {
  if (!Number.isSafeInteger(spawnedGroup) || spawnedGroup < 1) return false;
  try { process.kill(-spawnedGroup, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function signalGroup(signal) {
  if (!Number.isSafeInteger(spawnedGroup) || spawnedGroup < 1) return;
  try { process.kill(-spawnedGroup, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function waitForCleanup(timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (closed && !groupExists()) return true;
    await Promise.race([closed ? delay(25) : closedPromise, delay(25)]);
  }
  return closed && !groupExists();
}

async function stopOwnedProcesses() {
  signalGroup('SIGTERM');
  if (await waitForCleanup(TERMINATION_GRACE_MS)) return;
  signalGroup('SIGKILL');
  assert.ok(await waitForCleanup(FORCE_KILL_GRACE_MS), 'Owned development process group did not terminate');
}

async function assertBuildArtifacts() {
  for (const relative of [
    'dist/bin/agents-commander.js', 'dist/src/index.js', 'dist/index.d.ts',
    'dist/agents/pty-helper.py', 'dist/hardware/codex-micro-bridge.py',
    'dist/demo/demo-agent.js',
  ]) {
    const stat = await fs.lstat(path.join(repositoryRoot, relative));
    assert.ok(stat.isFile() && stat.size > 0, `Development build is missing ${relative}`);
  }
  const templates = await fs.readdir(path.join(repositoryRoot, 'dist/templates'));
  assert.equal(templates.filter((name) => name.endsWith('.md')).length, 121, 'Development hook must copy all prompt templates');
}

let passed = false;
try {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    assert.ok(!closed, `Development watch exited before readiness (${closeDescription})`);
    const text = stripVTControlCharacters(output);
    const ready = /^ESM\b[^\n]*\bBuild success\b/mu.test(text)
      && /^DTS\b[^\n]*\bBuild success\b/mu.test(text)
      && /CLI\s+Watching for changes/u.test(text);
    if (ready && Date.now() - lastOutputAt >= QUIET_PERIOD_MS) {
      await assertBuildArtifacts();
      if (failure) throw failure;
      assert.ok(!closed, `Development watch exited during artifact verification (${closeDescription})`);
      passed = true;
      break;
    }
    await delay(25);
  }
  assert.ok(passed, 'Development watch did not finish ESM, declarations and watcher startup within 25 seconds');
} catch (error) {
  process.stderr.write(`Development watch smoke failed: ${error.message}\n${stripVTControlCharacters(output).slice(-8 * 1024)}\n`);
  process.exitCode = 1;
} finally {
  try { await stopOwnedProcesses(); }
  catch (error) {
    process.stderr.write(`Development watch cleanup failed: ${error.message}\n`);
    process.exitCode = 1;
    // Report failed cleanup without allowing inherited output pipes to turn
    // this bounded smoke test into an indefinitely hanging parent process.
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
}

if (failure && !process.exitCode) {
  process.stderr.write(`Development watch smoke failed: ${failure.message}\n`);
  process.exitCode = 1;
}
if (passed && !process.exitCode) process.stdout.write('Development watch smoke passed: ESM, declarations, watcher, runtime assets and owned-process cleanup.\n');
