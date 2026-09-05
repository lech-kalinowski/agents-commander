#!/usr/bin/env node
// Explicit local registration. Provider credentials are never opened or printed.
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseRuntimeArguments } from './pi-runtime.mjs';

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ADAPTERS = new Set(['claude', 'codex', 'gemini', 'aider', 'cline', 'opencode', 'goose', 'kiro', 'amp', 'generic']);
const RUNTIME = fileURLToPath(new URL('./pi-runtime.mjs', import.meta.url));
export const USAGE = `Register prepared APEX Pi profiles in Agents Commander (Node.js 22+).

node Example/apex-sixteen-panel/register-pi.mjs \\
  --profiles /absolute/showcase/commander-profiles.json

Optional: --config /absolute/path/to/config.json
Default: ~/.agents-commander/config.json
Existing settings and profiles are preserved. Conflicting profile IDs are rejected.
Changed existing configuration receives a private backup before atomic replacement.
Registration does not open credentials or launch agents.
`;

export function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const names = new Map([['--profiles', 'profilesPath'], ['--config', 'configPath']]);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]);
    const value = args[index + 1];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith('--')) {
      throw new Error('Expected --profiles and optional --config exactly once. Use --help.');
    }
    options[name] = value;
  }
  if (!options.profilesPath) throw new Error('Missing required --profiles. Use --help.');
  return options;
}

function absolutePath(value) {
  if (typeof value !== 'string' || CONTROL.test(value) || !path.isAbsolute(value)) {
    throw new Error('Registration paths must be absolute and contain no control characters.');
  }
  return path.resolve(value);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 && !CONTROL.test(value);
}

function validExistingProfile(profile) {
  return object(profile) && typeof profile.id === 'string' && PROFILE_ID.test(profile.id)
    && text(profile.label) && profile.label.length <= 120 && ADAPTERS.has(profile.adapter)
    && (!Object.hasOwn(profile, 'command') || text(profile.command))
    && (!Object.hasOwn(profile, 'args') || (Array.isArray(profile.args)
      && profile.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))))
    && (!Object.hasOwn(profile, 'env') || (object(profile.env)
      && Object.entries(profile.env).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)
        && typeof value === 'string' && !value.includes('\0'))))
    && ['model', 'agent', 'configPath'].every((key) => !Object.hasOwn(profile, key)
      || (profile.adapter === 'opencode' && text(profile[key])
        && (key !== 'configPath' || path.isAbsolute(profile[key]))));
}

function validateFragment(fragment) {
  if (!object(fragment) || Object.keys(fragment).length !== 1 || !Array.isArray(fragment.agentProfiles)
    || fragment.agentProfiles.length < 1 || fragment.agentProfiles.length > 100) {
    throw new Error('Profiles input must contain only a nonempty agentProfiles array.');
  }
  const ids = new Set();
  for (const profile of fragment.agentProfiles) {
    if (!validExistingProfile(profile) || !/^apex-pi-[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(profile.id)
      || ids.has(profile.id) || profile.adapter !== 'generic'
      || Object.keys(profile).sort().join(',') !== 'adapter,args,command,id,label'
      || !path.isAbsolute(profile.command) || path.basename(profile.command) !== 'node'
      || !Array.isArray(profile.args) || profile.args.length !== 11 || profile.args[0] !== RUNTIME) {
      throw new Error('Input contains an invalid or duplicate generated APEX Pi profile.');
    }
    const options = parseRuntimeArguments(profile.args.slice(1));
    for (const name of ['entry', 'agentDir', 'credentials', 'prompt']) absolutePath(options[name]);
    if (!/^[A-Za-z0-9][A-Za-z0-9_./:@+-]*$/u.test(options.model)
      || options.model.length > 240 || /(?:EXACT_MODEL_ID|MODEL_NAME|REPLACE_ME|your[-_]model)/iu.test(options.model)) {
      throw new Error('Input contains an invalid explicit Pi model.');
    }
    ids.add(profile.id);
  }
  return fragment.agentProfiles;
}

async function readRegular(filename, allowMissing = false) {
  let handle;
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error();
    handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error();
    const bytes = await handle.readFile();
    if (bytes.length > 4 * 1024 * 1024) throw new Error();
    return { bytes, ino: opened.ino, dev: opened.dev };
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    throw new Error('Registration input and configuration must be readable regular files, at most 4 MiB, without symlinks.');
  } finally {
    await handle?.close();
  }
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Registration input or existing configuration is not valid JSON.'); }
}

async function writePrivate(filename, bytes) {
  const handle = await fs.open(filename, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
  } catch (error) {
    // Only this call's exclusive creation is removed; retain the original failure.
    await handle.close().catch(() => {});
    await fs.unlink(filename).catch(() => {});
    throw error;
  }
}

async function assertUnchanged(filename, original) {
  const current = await readRegular(filename, true);
  if ((!original && current) || (original && (!current || current.ino !== original.ino
    || current.dev !== original.dev || !current.bytes.equals(original.bytes)))) {
    throw new Error('Commander configuration changed during registration; retry after the other writer finishes.');
  }
}

export async function registerPiProfiles({ profilesPath, configPath = path.join(os.homedir(), '.agents-commander', 'config.json') }) {
  const source = absolutePath(profilesPath);
  const target = absolutePath(configPath);
  if (source === target) throw new Error('Profiles input and Commander configuration must be different files.');
  const incoming = validateFragment(parseJson((await readRegular(source)).bytes));
  const original = await readRegular(target, true);
  const config = original ? parseJson(original.bytes) : {};
  if (!object(config) || (Object.hasOwn(config, 'agentProfiles') && !Array.isArray(config.agentProfiles))) {
    throw new Error('Existing Commander configuration must be an object with an optional agentProfiles array.');
  }
  const existing = config.agentProfiles ?? [];
  const ids = new Map();
  for (const profile of existing) {
    if (!validExistingProfile(profile) || ids.has(profile.id)) {
      throw new Error('Existing Commander configuration contains invalid or duplicate profiles.');
    }
    ids.set(profile.id, profile);
  }
  const additions = [];
  for (const profile of incoming) {
    if (ids.has(profile.id)) {
      if (!isDeepStrictEqual(ids.get(profile.id), profile)) {
        throw new Error('An APEX Pi profile ID already exists with different settings; no configuration was changed.');
      }
    } else additions.push(profile);
  }
  if (additions.length === 0) return { configPath: target, added: 0, unchanged: incoming.length, backupPath: null };

  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Commander configuration directory must be a regular directory without a symlink.');
  }
  const suffix = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  const temporary = path.join(directory, `.${path.basename(target)}.pi-${suffix}.tmp`);
  const backupPath = original ? `${target}.backup-${suffix}` : null;
  const bytes = `${JSON.stringify({ ...config, agentProfiles: [...existing, ...additions] }, null, 2)}\n`;
  let temporaryCreated = false;
  try {
    await writePrivate(temporary, bytes);
    temporaryCreated = true;
    await assertUnchanged(target, original);
    if (original) {
      await writePrivate(backupPath, original.bytes);
      await assertUnchanged(target, original);
      await fs.rename(temporary, target);
      temporaryCreated = false;
    } else {
      // link is an atomic create-if-absent; rename could overwrite a new config.
      await fs.link(temporary, target);
    }
  } finally {
    if (temporaryCreated) await fs.unlink(temporary);
  }
  return { configPath: target, added: additions.length, unchanged: incoming.length - additions.length, backupPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write(USAGE);
    else {
      if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
      const result = await registerPiProfiles(options);
      process.stdout.write(`Registered ${result.added} APEX Pi profiles; ${result.unchanged} already identical.\nConfiguration: ${result.configPath}\n`);
      if (result.backupPath) process.stdout.write(`Previous configuration backup: ${result.backupPath}\n`);
    }
  } catch (error) {
    // Errors from filesystem operations expose paths at most, never JSON contents.
    process.stderr.write(`APEX Pi registration failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
