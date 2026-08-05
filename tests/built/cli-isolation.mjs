#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-commander-built-cli-'));
const poisonMarker = 'UI_DEPENDENCY_WAS_IMPORTED';

async function installPoisonedDependency(packageName) {
  const packageDirectory = path.join(fixtureRoot, 'node_modules', packageName);
  const exportPrelude = {
    blessed: 'export default {};\n',
    chokidar: 'export function watch() {}\n',
    marked: 'export const marked = {};\n',
    'marked-terminal': 'export default class TerminalRenderer {}\n',
  }[packageName];
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0-isolation-test',
      type: 'module',
      exports: './index.js',
    }),
  );
  await fs.writeFile(
    path.join(packageDirectory, 'index.js'),
    `${exportPrelude}throw new Error(${JSON.stringify(`${poisonMarker}:${packageName}`)});\n`,
  );
}

function spawnCli(args) {
  return spawnSync(
    process.execPath,
    [path.join(fixtureRoot, 'dist', 'bin', 'agents-commander.js'), ...args],
    {
      cwd: path.join(fixtureRoot, 'workspace'),
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: path.join(fixtureRoot, 'home'),
        NO_COLOR: '1',
      },
      timeout: 15_000,
    },
  );
}

function runLightweightCli(args) {
  const result = spawnCli(args);
  assert.equal(result.error, undefined, `CLI process failed to start: ${result.error?.message}`);
  assert.equal(result.signal, null, `CLI process was terminated by ${result.signal}`);
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(combinedOutput, new RegExp(poisonMarker));
  assert.doesNotMatch(combinedOutput, /ERR_MODULE_NOT_FOUND|Cannot find package/u);
  return result;
}

try {
  await fs.cp(
    path.join(repositoryRoot, 'dist'),
    path.join(fixtureRoot, 'dist'),
    { recursive: true },
  );
  await fs.copyFile(
    path.join(repositoryRoot, 'package.json'),
    path.join(fixtureRoot, 'package.json'),
  );
  await fs.mkdir(path.join(fixtureRoot, 'node_modules'), { recursive: true });
  await fs.cp(
    path.join(repositoryRoot, 'node_modules', 'commander'),
    path.join(fixtureRoot, 'node_modules', 'commander'),
    { recursive: true },
  );
  await Promise.all(
    ['blessed', 'chokidar', 'marked', 'marked-terminal'].map(installPoisonedDependency),
  );
  await fs.mkdir(path.join(fixtureRoot, 'workspace'), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, 'home'), { recursive: true });

  const packageMetadata = JSON.parse(
    await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  );

  const help = runLightweightCli(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: agents-commander/u);
  assert.match(help.stdout, /--doctor/u);
  assert.match(help.stdout, /--codex-micro(?:\s|$)/mu);
  assert.match(help.stdout, /--no-codex-micro\b/u);
  assert.match(help.stdout, /--codex-micro-test\b/u);

  const version = runLightweightCli(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageMetadata.version);

  const doctor = runLightweightCli(['--doctor']);
  assert.ok(
    doctor.status === 0 || doctor.status === 1,
    `Unexpected Doctor exit status ${doctor.status}: ${doctor.stderr}`,
  );
  assert.match(doctor.stdout, /Agents Commander Doctor/u);
  assert.match(doctor.stdout, /\[PASS\] PTY helper:/u);
  assert.match(doctor.stdout, /\[PASS\] Offline demo agent:/u);

  // Use the explicit keyboard fallback here so this isolation test is
  // deterministic even when a real Codex Micro is connected to the host.
  const microDoctor = runLightweightCli(['--doctor', '--codex-micro-keyboard']);
  assert.ok(
    microDoctor.status === 0 || microDoctor.status === 1,
    `Unexpected Codex Micro Doctor exit status ${microDoctor.status}: ${microDoctor.stderr}`,
  );
  assert.match(microDoctor.stdout, /\[WARN\] Codex Micro:/u);
  assert.match(microDoctor.stdout, /device identity is not checked/u);
  assert.match(microDoctor.stdout, /--codex-micro-test/u);

  const uiLaunch = spawnCli([]);
  assert.equal(uiLaunch.error, undefined, `UI isolation control failed: ${uiLaunch.error?.message}`);
  assert.equal(uiLaunch.status, 1, 'The poisoned UI dependency should stop an interactive launch');
  assert.match(`${uiLaunch.stdout}\n${uiLaunch.stderr}`, new RegExp(poisonMarker));

  process.stdout.write('Built CLI isolation checks passed.\n');
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
