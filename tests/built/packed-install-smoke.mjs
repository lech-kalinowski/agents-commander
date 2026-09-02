#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_TEMPLATE_COUNT = 121;
const MINIMUM_NODE_MAJOR = 22;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const packageMetadata = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
const fixtureRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), 'agents-commander-packed-install-'),
);
const packDirectory = path.join(fixtureRoot, 'pack');
const consumerDirectory = path.join(fixtureRoot, 'consumer');
const workspaceDirectory = path.join(consumerDirectory, 'workspace');
const homeDirectory = path.join(fixtureRoot, 'home');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCacheDirectory = process.env.npm_config_cache
  ?? path.join(os.homedir(), '.npm');

function run(command, args, options = {}) {
  const {
    cwd = repositoryRoot,
    expectedStatuses = [0],
    label = `${command} ${args.join(' ')}`,
    timeout = 120_000,
  } = options;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDirectory,
      NO_COLOR: '1',
      npm_config_cache: npmCacheDirectory,
    },
    timeout,
  });

  assert.equal(
    result.error,
    undefined,
    `${label} failed to start: ${result.error?.message}`,
  );
  assert.equal(result.signal, null, `${label} was terminated by ${result.signal}`);
  assert.ok(
    expectedStatuses.includes(result.status),
    `${label} exited with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

try {
  await Promise.all([
    fs.mkdir(packDirectory, { recursive: true }),
    fs.mkdir(workspaceDirectory, { recursive: true }),
    fs.mkdir(homeDirectory, { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(consumerDirectory, 'package.json'),
    JSON.stringify({
      name: 'agents-commander-packed-consumer',
      version: '1.0.0',
      private: true,
      type: 'module',
    }),
  );

  // --ignore-scripts is required here: this smoke test runs from `verify`,
  // which is also the package's prepack hook.
  const packed = run(npmCommand, [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    packDirectory,
  ], { label: 'npm pack' });
  const packReport = JSON.parse(packed.stdout);
  assert.equal(packReport.length, 1, 'npm pack must produce exactly one tarball');
  assert.equal(packReport[0].name, packageMetadata.name);
  assert.equal(packReport[0].version, packageMetadata.version);

  const packedPaths = new Set(packReport[0].files.map((entry) => entry.path));
  for (const requiredPath of [
    'dist/bin/agents-commander.js',
    'dist/index.d.ts',
    'dist/agents/pty-helper.py',
    'dist/hardware/codex-micro-bridge.py',
    'dist/demo/demo-agent.js',
    'docs/codex-micro.md',
    'docs/datasets.md',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    assert.ok(packedPaths.has(requiredPath), `Packed package is missing ${requiredPath}`);
  }
  assert.equal(
    [...packedPaths].filter((filePath) => filePath.startsWith('dist/templates/')).length,
    EXPECTED_TEMPLATE_COUNT,
    `Packed package must contain exactly ${EXPECTED_TEMPLATE_COUNT} templates`,
  );
  assert.equal(
    [...packedPaths].some((filePath) => filePath.endsWith('.map')),
    false,
    'Source maps must not be published',
  );
  const privateArtifactPath = /(?:^|\/)(?:capture-[^/]+|commander-reviews|commander-datasets)\/|\.jsonl$/u;
  assert.doesNotMatch('dist/capture-EXAMPLE.js', privateArtifactPath);
  for (const privatePath of [
    'capture-example/manifest.json', 'dist/capture-example/segment.jsonl',
    'commander-reviews/review.json', 'dist/commander-datasets/manifest.json',
    'dist/nested/train.jsonl',
  ]) {
    assert.match(privatePath, privateArtifactPath);
  }
  for (const packedPath of packedPaths) {
    assert.doesNotMatch(packedPath, privateArtifactPath,
      'Private captures and dataset rows must not be published');
  }

  const tarballPath = path.join(packDirectory, packReport[0].filename);
  run(npmCommand, [
    'install',
    '--prefer-offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarballPath,
  ], {
    cwd: consumerDirectory,
    label: 'tarball install',
  });

  const installedRoot = path.join(
    consumerDirectory,
    'node_modules',
    packageMetadata.name,
  );
  const installedMetadata = JSON.parse(
    await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8'),
  );
  assert.equal(installedMetadata.version, packageMetadata.version);
  assert.equal(installedMetadata.engines.node, '>=22.0.0');

  const binaryPath = path.join(
    consumerDirectory,
    'node_modules',
    '.bin',
    'agents-commander',
  );
  await fs.access(binaryPath, fsConstants.X_OK);

  const version = run(binaryPath, ['--version'], {
    cwd: workspaceDirectory,
    label: 'packed CLI --version',
  });
  assert.equal(version.stdout.trim(), packageMetadata.version);

  const help = run(binaryPath, ['--help'], {
    cwd: workspaceDirectory,
    label: 'packed CLI --help',
  });
  assert.match(help.stdout, /Usage: agents-commander/u);
  assert.match(help.stdout, /--doctor/u);
  assert.match(help.stdout, /--conference/u);
  assert.match(help.stdout, /--demo/u);
  assert.match(help.stdout, /--codex-micro(?:\s|$)/mu);
  assert.match(help.stdout, /--codex-micro-keyboard\b/u);
  assert.match(help.stdout, /--codex-micro-decisions\b/u);
  assert.match(help.stdout, /--no-codex-micro-decisions\b/u);
  assert.match(help.stdout, /--no-codex-micro\b/u);
  assert.match(help.stdout, /--codex-micro-test\b/u);

  const currentNodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  const doctor = run(binaryPath, ['--doctor', workspaceDirectory], {
    cwd: workspaceDirectory,
    expectedStatuses: currentNodeMajor >= MINIMUM_NODE_MAJOR ? [0] : [1],
    label: 'packed CLI --doctor',
  });
  assert.match(doctor.stdout, /\[PASS\] PTY helper:/u);
  assert.match(doctor.stdout, /\[PASS\] PTY runtime:/u);
  assert.match(
    doctor.stdout,
    new RegExp(`\\[PASS\\] Built-in templates: ${EXPECTED_TEMPLATE_COUNT} Markdown templates`, 'u'),
  );
  assert.match(doctor.stdout, /\[PASS\] Offline demo agent:/u);
  if (currentNodeMajor < MINIMUM_NODE_MAJOR) {
    assert.match(
      doctor.stdout,
      new RegExp(`\\[FAIL\\] Node\\.js: Node\\.js ${MINIMUM_NODE_MAJOR} or newer is required`, 'u'),
    );
  }

  const microDoctor = run(binaryPath, ['--doctor', '--codex-micro', workspaceDirectory], {
    cwd: workspaceDirectory,
    expectedStatuses: currentNodeMajor >= MINIMUM_NODE_MAJOR ? [0] : [1],
    label: 'packed CLI --doctor --codex-micro',
  });
  assert.match(microDoctor.stdout, /Codex Micro:/u);
  assert.doesNotMatch(microDoctor.stdout, /serial/iu);

  const microKeyboardDoctor = run(
    binaryPath,
    ['--doctor', '--codex-micro-keyboard', workspaceDirectory],
    {
      cwd: workspaceDirectory,
      expectedStatuses: currentNodeMajor >= MINIMUM_NODE_MAJOR ? [0] : [1],
      label: 'packed CLI --doctor --codex-micro-keyboard',
    },
  );
  assert.match(microKeyboardDoctor.stdout, /\[WARN\] Codex Micro:/u);
  assert.match(microKeyboardDoctor.stdout, /keyboard fallback/iu);
  assert.match(microKeyboardDoctor.stdout, /--codex-micro-test/u);

  const packageImport = run(process.execPath, [
    '--input-type=module',
    '--eval',
    [
      "const packageApi = await import('agents-commander');",
      "if (typeof packageApi.App !== 'function') throw new Error('App export missing');",
      "if (typeof packageApi.VTerm !== 'function') throw new Error('VTerm export missing');",
      "if (packageApi.getCodexMicroAction('C-S-f11') !== 'approve') throw new Error('Codex Micro export missing');",
    ].join('\n'),
  ], {
    cwd: consumerDirectory,
    label: 'packed root ESM import',
  });
  assert.equal(packageImport.stderr, '');

  const typeFixturePath = path.join(consumerDirectory, 'consumer.ts');
  const typeConfigPath = path.join(consumerDirectory, 'tsconfig.json');
  await fs.writeFile(typeFixturePath, [
    "import { App, VTerm, type AppConfig, type AppLaunchOptions, type CodexMicroAction } from 'agents-commander';",
    'const options: AppLaunchOptions = { conference: true, panels: 2 };',
    "const microAction: CodexMicroAction = 'approve';",
    "const legacyConfig: AppConfig = { theme: 'classic-blue', panelCount: 2, panelDensity: 'auto', showHidden: false, sortBy: 'name', sortAscending: true, watchDebounce: 100, editor: { tabSize: 2, wordWrap: true }, agents: {}, agentProfiles: [] };",
    'const AppConstructor: typeof App = App;',
    'const terminal = new VTerm(80, 24);',
    'void [options, microAction, legacyConfig, AppConstructor, terminal];',
    '',
  ].join('\n'));
  await fs.writeFile(typeConfigPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: ['node'],
    },
    files: ['./consumer.ts'],
  }));
  run(process.execPath, [
    path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--project',
    typeConfigPath,
  ], {
    cwd: consumerDirectory,
    label: 'packed TypeScript consumer',
  });

  for (const requiredAsset of [
    path.join(installedRoot, 'dist', 'index.d.ts'),
    path.join(installedRoot, 'dist', 'agents', 'pty-helper.py'),
    path.join(installedRoot, 'dist', 'hardware', 'codex-micro-bridge.py'),
    path.join(installedRoot, 'dist', 'demo', 'demo-agent.js'),
    path.join(installedRoot, 'docs', 'codex-micro.md'),
    path.join(installedRoot, 'THIRD_PARTY_NOTICES.md'),
  ]) {
    assert.equal((await fs.lstat(requiredAsset)).isFile(), true, `${requiredAsset} is not a file`);
  }
  const thirdPartyNotices = await fs.readFile(
    path.join(installedRoot, 'THIRD_PARTY_NOTICES.md'),
    'utf8',
  );
  assert.match(thirdPartyNotices, /Copyright \(c\) 2026 Eli Benveniste/u);
  assert.match(
    thirdPartyNotices,
    /64258eb6cc3312a43f9f9f86d87e55e0b609ccc5/u,
  );
  assert.match(thirdPartyNotices, /THE SOFTWARE IS PROVIDED "AS IS"/u);
  const installedTemplates = (await fs.readdir(
    path.join(installedRoot, 'dist', 'templates'),
  )).filter((name) => name.endsWith('.md'));
  assert.equal(installedTemplates.length, EXPECTED_TEMPLATE_COUNT);

  process.stdout.write('Packed install smoke checks passed.\n');
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
