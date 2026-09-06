#!/usr/bin/env node
// Source-checkout Pi launcher. Credentials stay out of argv, generated config and output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const OPTION_NAMES = new Map([
  ['--entry', 'entry'], ['--agent-dir', 'agentDir'], ['--credentials', 'credentials'],
  ['--model', 'model'], ['--prompt', 'prompt'],
]);

export function parseRuntimeArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--smoke' && !options.smoke) { options.smoke = true; continue; }
    const name = OPTION_NAMES.get(args[index]);
    const value = args[++index];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith('--')) {
      throw new Error('Invalid Pi launcher options. Use a generated Commander profile.');
    }
    options[name] = value;
  }
  if ([...OPTION_NAMES.values()].some((name) => !options[name])) {
    throw new Error('Pi launcher requires entry, agent-dir, credentials, model and prompt.');
  }
  return options;
}

export function readApexCredentials(filename) {
  // This is a data file, never a shell script or an environment file to execute.
  let content;
  try {
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size > 16384) throw new Error();
    content = fs.readFileSync(filename, 'utf8');
  } catch {
    throw new Error('Cannot read the APEX credential file.');
  }
  const lines = content.trim().split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const endpoint = lines.find((line) => line.startsWith('https://'));
  const key = lines.find((line) => line !== endpoint);
  if (lines.length !== 2 || !endpoint || !key || /\s/u.test(key) || CONTROL.test(key)) {
    throw new Error('APEX credential file must contain a key and HTTPS base URL on separate lines.');
  }
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Invalid APEX endpoint.'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid APEX endpoint.');
  return { key, baseUrl: url.href.replace(/\/$/u, '') };
}

export function resolvePiLaunch(options) {
  for (const name of ['entry', 'agentDir', 'credentials', 'prompt']) {
    if (typeof options[name] !== 'string' || !path.isAbsolute(options[name]) || CONTROL.test(options[name])) {
      throw new Error('Pi launcher paths must be absolute and contain no control characters.');
    }
  }
  if (typeof options.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./:@+-]*$/u.test(options.model)) {
    throw new Error('Invalid explicit APEX model ID.');
  }
  let models;
  let prompt;
  try {
    if (!fs.statSync(options.entry).isFile()) throw new Error();
    models = JSON.parse(fs.readFileSync(path.join(options.agentDir, 'models.json'), 'utf8'));
    prompt = fs.readFileSync(options.prompt, 'utf8');
  } catch {
    throw new Error('Pi runtime, generated model config or role prompt is unavailable. Prepare the showcase first.');
  }
  const provider = models.providers?.apex;
  const { key, baseUrl } = readApexCredentials(options.credentials);
  if (provider?.baseUrl?.replace(/\/$/u, '') !== baseUrl
    || provider.apiKey !== '$APEX_API_KEY'
    || provider.api !== 'openai-completions'
    || !provider.models?.some((model) => model.id === options.model)) {
    throw new Error('Generated Pi model configuration does not match the supplied APEX endpoint/model.');
  }
  const args = [
    '--provider', 'apex', '--model', options.model,
    '--system-prompt', prompt,
    '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates',
    '--no-themes', '--no-context-files', '--no-approve', '--no-session', '--offline',
  ];
  if (options.smoke) args.push('--print', 'Reply exactly APEX_PI_READY. This is a connectivity check, not a review task.');
  return {
    entry: options.entry,
    args,
    env: { APEX_API_KEY: key, PI_CODING_AGENT_DIR: options.agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0' },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw new Error('Pi requires Node.js 22.19 or newer.');
    const launch = resolvePiLaunch(parseRuntimeArguments(process.argv.slice(2)));
    Object.assign(process.env, launch.env);
    process.argv = [process.execPath, launch.entry, ...launch.args];
    // Run the installed CLI in this same process so Commander owns its complete lifecycle.
    await import(pathToFileURL(launch.entry).href);
  } catch {
    // Do not print third-party exception messages: they can contain request credentials.
    process.stderr.write('APEX Pi could not start. Check Node >=22.19, the Pi entry, generated profiles and credential file.\n');
    process.exitCode = 1;
  }
}
