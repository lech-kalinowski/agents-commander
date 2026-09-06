import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRuntimeArguments, readApexCredentials, resolvePiLaunch } from '../../Example/apex-sixteen-panel/pi-runtime.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-pi-launch-'));
  roots.push(root);
  const options = {
    entry: path.join(root, 'fake pi.mjs'), agentDir: root,
    credentials: path.join(root, 'private-key'), prompt: path.join(root, 'role.md'), model: 'vendor/apex-test',
  };
  await fs.writeFile(options.credentials, 'PRIVATE_TEST_KEY\nhttps://provider.example/v1\n', { mode: 0o600 });
  await fs.writeFile(options.prompt, 'Role with spaces and literal $(never-executed).');
  await fs.writeFile(path.join(root, 'models.json'), JSON.stringify({ providers: { apex: {
    baseUrl: 'https://provider.example/v1', api: 'openai-completions', apiKey: '$APEX_API_KEY',
    models: [{ id: options.model }],
  } } }));
  // Report only booleans: neither a real provider nor credential output is needed.
  await fs.writeFile(options.entry, `
    console.log(JSON.stringify({
      credentialAvailable: process.env.APEX_API_KEY === 'PRIVATE_TEST_KEY',
      credentialInArgv: process.argv.join(' ').includes('PRIVATE_TEST_KEY'),
      inputPreserved: process.argv.includes('Role with spaces and literal $(never-executed).'),
      ephemeral: process.argv.includes('--no-session'),
      noTools: process.argv.includes('--no-tools'),
      model: process.argv[process.argv.indexOf('--model') + 1],
      sameProcess: !!process.env.PI_CODING_AGENT_DIR
    }));
  `);
  return options;
}

function argv(options: Awaited<ReturnType<typeof fixture>>) {
  return ['--entry', options.entry, '--agent-dir', options.agentDir, '--credentials', options.credentials,
    '--model', options.model, '--prompt', options.prompt];
}

describe('Pi credential-aware launcher', () => {
  it('runs the selected CLI in-process with literal arguments and credentials only in the environment', async () => {
    const options = await fixture();
    const child = spawnSync(process.execPath, [path.resolve('Example/apex-sixteen-panel/pi-runtime.mjs'), ...argv(options)], {
      encoding: 'utf8', timeout: 5000,
    });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout)).toEqual({
      credentialAvailable: true, credentialInArgv: false, inputPreserved: true,
      ephemeral: true, noTools: true, model: options.model, sameProcess: true,
    });
  });

  it('rejects an endpoint mismatch before handing the key to Pi', async () => {
    const options = await fixture();
    await fs.writeFile(options.credentials, 'PRIVATE_TEST_KEY\nhttps://different.example/v1');
    expect(() => resolvePiLaunch(options)).toThrow('does not match');
    const child = spawnSync(process.execPath, [path.resolve('Example/apex-sixteen-panel/pi-runtime.mjs'), ...argv(options)], {
      encoding: 'utf8', timeout: 5000,
    });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe('');
    expect(child.stderr).not.toContain('PRIVATE_TEST_KEY');
  });

  it('keeps Pi interactive by default and enables inference smoke mode only explicitly', async () => {
    const options = await fixture();
    expect(resolvePiLaunch(options).args).not.toContain('--print');
    const launch = resolvePiLaunch({ ...options, smoke: true });
    expect(launch.args).toContain('--print');
    expect(launch.args).toContain('--no-context-files');
    expect(launch.args).toContain('--no-approve');
    expect(launch.env.PI_OFFLINE).toBe('1');
    expect(parseRuntimeArguments([...argv(options), '--smoke']).smoke).toBe(true);
    expect(() => parseRuntimeArguments([...argv(options), '--model', 'another'])).toThrow();
    expect(() => parseRuntimeArguments([...argv(options), '--api-key', 'SECRET'])).toThrow();
  });

  it.each(['SECRET', 'SECRET\nhttp://provider.example/v1', 'SECRET\nhttps://provider.example/v1?key=SECRET',
    'SECRET\nhttps://user:password@provider.example/v1', 'SECRET\nhttps://provider.example/v1\nextra'])
  ('rejects malformed credential material without echoing it (%#)', async (content) => {
    const options = await fixture();
    await fs.writeFile(options.credentials, content);
    expect(() => readApexCredentials(options.credentials)).toThrow();
  });
});
