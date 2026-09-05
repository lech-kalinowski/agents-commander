#!/usr/bin/env node
// Offline preparation only: credentials are opaque and no agent is launched.
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolePrompt } from './prepare.mjs';
import { SCENARIO } from './scenario.mjs';

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const RUNTIME = fileURLToPath(new URL('./pi-runtime.mjs', import.meta.url));
export const USAGE = `Prepare the APEX sixteen-panel Pi showcase (Node.js 22.19+).

node Example/apex-sixteen-panel/prepare-pi.mjs \\
  --model callstack/Apex-20260831 \\
  --base-url https://your-provider.example/v1 \\
  --pi-entry /absolute/path/to/installed/pi/dist/cli.js \\
  --credentials /absolute/path/to/existing/private-credentials \\
  --out /absolute/path/to/new-showcase-directory

All five options are required. Supply your provider's actual model and base URL.
Preparation does not read or copy credentials, start agents, install software,
make network requests, or change configuration outside the new output directory.
`;

export function requireSupportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 19))) {
    throw new Error('Pi requires Node.js 22.19 or newer.');
  }
}

export function validatePiModel(model) {
  if (typeof model !== 'string' || model.length > 240
    || !/^[A-Za-z0-9][A-Za-z0-9_./:@+-]*$/u.test(model)
    || /(?:EXACT_MODEL_ID|MODEL_NAME|REPLACE_ME|your[-_]model)/iu.test(model)) {
    throw new Error('Supply an explicit model ID without whitespace, control characters or placeholders.');
  }
  return model;
}

export function validateBaseUrl(value) {
  let url;
  try {
    if (typeof value !== 'string' || /\s/u.test(value) || CONTROL.test(value)) throw new Error();
    url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
      || value.includes('?') || value.includes('#')) throw new Error();
  } catch {
    throw new Error('baseUrl must be an HTTPS URL without user information, query or fragment.');
  }
  return url.href.replace(/\/$/u, '');
}

export function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const names = new Map([
    ['--model', 'model'], ['--base-url', 'baseUrl'], ['--pi-entry', 'piEntry'],
    ['--credentials', 'credentials'], ['--out', 'out'],
  ]);
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = names.get(args[i]);
    if (!key || Object.hasOwn(result, key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Expected each Pi showcase option exactly once. Use --help.');
    }
    result[key] = args[i + 1];
  }
  if ([...names.values()].some((key) => !result[key])) {
    throw new Error('Missing --model, --base-url, --pi-entry, --credentials or --out. Use --help.');
  }
  return result;
}

function absolutePath(value, name) {
  if (typeof value !== 'string' || CONTROL.test(value) || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path without control characters.`);
  }
  return path.resolve(value);
}

function profileId(role) {
  return `apex-pi-${role.id.replace(/^apex-/u, '')}`;
}

export function buildPiProfiles({ model, piEntry, credentials, out }) {
  validatePiModel(model);
  const entry = absolutePath(piEntry, 'piEntry');
  const credentialPath = absolutePath(credentials, 'credentials');
  const destination = absolutePath(out, 'out');
  return SCENARIO.roles.map((role) => {
    const id = profileId(role);
    const roleDir = path.join(destination, 'roles', id);
    return {
      id,
      label: `APEX Pi P${String(role.panel).padStart(2, '0')} ${role.label.replace(/^APEX /u, '')}`,
      adapter: 'generic',
      command: process.execPath,
      args: [RUNTIME, '--entry', entry, '--agent-dir', roleDir,
        '--credentials', credentialPath, '--model', model, '--prompt', path.join(roleDir, 'prompt.md')],
    };
  });
}

export async function preparePiShowcase(options) {
  requireSupportedNode();
  const model = validatePiModel(options.model);
  const baseUrl = validateBaseUrl(options.baseUrl);
  const piEntry = absolutePath(options.piEntry, 'piEntry');
  const credentials = absolutePath(options.credentials, 'credentials');
  const out = absolutePath(options.out, 'out');
  for (const [name, location] of [['Pi entrypoint', piEntry], ['Credentials', credentials]]) {
    try {
      if (!(await fs.stat(location)).isFile()) throw new Error();
      await fs.access(location, constants.R_OK);
    } catch {
      throw new Error(`${name} must be an existing readable regular file; contents were not read.`);
    }
  }
  const profiles = buildPiProfiles({ model, piEntry, credentials, out });
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const startPrompt = SCENARIO.startPrompt.replaceAll('OpenCode', 'Pi').replace(/\s+/gu, ' ').trim();
  const evaluationChecklist = SCENARIO.evaluationChecklist.map((entry) => entry.replaceAll('OpenCode', 'Pi'));
  const files = {
    '.gitignore': '*\n',
    'commander-profiles.json': json({ agentProfiles: profiles }),
    'scenario.json': json({ ...SCENARIO, startPrompt, evaluationChecklist, harness: 'pi', protocolAdapter: 'generic', model, baseUrl,
      modelIdentity: 'declared-by-user', liveModelVerified: false,
      configuredLimits: { contextWindow: 32768, maxTokens: 2048 } }),
    'brief.txt': `${SCENARIO.title}\n\n${SCENARIO.brief}\n`,
    'start.txt': `${startPrompt}\n`,
    ...Object.fromEntries(SCENARIO.waves.slice(1).map((_wave, index) => [
      `continue-wave-${index + 2}.txt`, `CONTINUE APEX WAVE ${index + 2}\n`,
    ])),
    'checklist.txt': `${evaluationChecklist.map((entry) => `- ${entry}`).join('\n')}\n`,
    'SETUP.txt': `APEX Pi sixteen-panel showcase — prepared, not live-verified.
Merge agentProfiles from commander-profiles.json into your existing Commander
config, preserving other settings and resolving duplicate profile IDs explicitly.
Launch the matching APEX Pi profiles in stable P1-P16 and use Ctrl+P in each.
Send start.txt to the existing coordinator P1 using Ctrl+O. Send each later
continue-wave-N.txt only after checking every result from the previous wave.
The configured 32768 context and 2048 output limits are conservative settings,
not verified provider capabilities. Role instructions are not an enforced scheduler.
The private credentials file is referenced by path and read only at launch by the
Pi runtime wrapper. Its contents were not read or copied during preparation.
Preparation made no model calls and changed no global configuration.
See Example/apex-sixteen-panel/README.md in this source checkout for the runbook.
`,
  };
  const roleDirectories = [];
  for (const role of SCENARIO.roles) {
    const relative = path.join('roles', profileId(role));
    roleDirectories.push(relative);
    files[path.join(relative, 'models.json')] = json({ providers: { apex: {
      baseUrl, api: 'openai-completions', apiKey: '$APEX_API_KEY',
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
      models: [{ id: model, name: 'APEX', contextWindow: 32768, maxTokens: 2048, samplingParams: { tool_choice: 'none' } }],
    } } });
    files[path.join(relative, 'settings.json')] = json({
      compaction: { enabled: false },
      retry: { enabled: false, provider: { timeoutMs: 60000, maxRetries: 0 } },
    });
    files[path.join(relative, 'prompt.md')] = rolePrompt(role, 'generic');
  }
  try {
    await fs.mkdir(out, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output already exists. Choose a new directory; nothing was overwritten.');
    throw new Error('Could not create output directory. Its parent must already exist and be writable.');
  }
  try {
    await fs.mkdir(path.join(out, 'roles'), { mode: 0o700 });
    for (const relative of roleDirectories) await fs.mkdir(path.join(out, relative), { mode: 0o700 });
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(out, name), content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
  } catch {
    throw new Error('Preparation incomplete. The new output directory was left for inspection; use a fresh output path.');
  }
  return { out, profiles: profiles.length, waves: SCENARIO.waves, files: Object.keys(files), liveModelVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireSupportedNode();
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write(USAGE);
    else process.stdout.write(`${JSON.stringify(await preparePiShowcase(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Pi showcase preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
