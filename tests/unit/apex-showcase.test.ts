import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCENARIO } from '../../Example/apex-sixteen-panel/scenario.mjs';
import {
  buildProfiles, parseArguments, prepareShowcase, rolePrompt, validateModel,
} from '../../Example/apex-sixteen-panel/prepare.mjs';
import { buildOpenCodeLaunchConfig } from '../../src/agents/opencode-adapter.js';
import type { OpenCodeAgentProfile } from '../../src/agents/types.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-apex-example-'));
  roots.push(root);
  const configPath = path.join(root, 'provider config.jsonc');
  // Deliberately not JSON. Preparation must treat provider configuration as opaque.
  await fs.writeFile(configPath, '// PRIVATE_PROVIDER_SENTINEL_DO_NOT_COPY\nnot parsed here');
  return { root, model: 'test-provider/apex-fixture', configPath, out: path.join(root, 'new showcase') };
}

describe('offline sixteen-panel APEX example preparation', () => {
  it('assigns sixteen unique roles to seven bounded waves exactly once', () => {
    expect(SCENARIO.roles.map((role) => role.panel)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(new Set(SCENARIO.roles.map((role) => role.id)).size).toBe(16);
    expect(SCENARIO.waves).toEqual([[2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13], [14], [15], [16]]);
    expect(SCENARIO.waves.flat()).toEqual(Array.from({ length: 15 }, (_, i) => i + 2));
    expect(SCENARIO.waves.every((wave) => wave.length <= 3)).toBe(true);
    for (const role of SCENARIO.roles.slice(1)) expect(SCENARIO.waves[role.wave - 1]).toContain(role.panel);
  });

  it('uses a short, single-line explicit START and human continuation gates', () => {
    expect(SCENARIO.startPrompt).toMatch(/^START APEX SHOWCASE/u);
    expect(SCENARIO.startPrompt).not.toMatch(/[\r\n]/u);
    expect(SCENARIO.startPrompt.length).toBeLessThanOrEqual(600);
    expect(SCENARIO.startPrompt).toContain('Ctrl+P');
    const coordinator = rolePrompt(SCENARIO.roles[0]);
    expect(coordinator).toContain('START APEX SHOWCASE authorizes only wave 1');
    expect(coordinator).toContain('CONTINUE APEX WAVE 2');
    expect(coordinator).toContain('never REPLY or BROADCAST');
    expect(coordinator).toContain('At most three specialist tasks may be pending');
    expect(coordinator).toContain('After P16 replies');
    for (const worker of SCENARIO.roles.slice(1)) expect(coordinator).toContain(`P${worker.panel}: ${worker.role}`);
    for (const role of SCENARIO.roles.slice(1)) {
      const prompt = rolePrompt(role);
      expect(prompt).toContain('exactly one substantive REPLY');
      expect(prompt).toContain('Do not SEND');
      expect(prompt).toContain('informational delivery ACKs');
      expect(prompt).toContain(SCENARIO.brief);
    }
  });

  it('pins the selected model and role using the existing safe OpenCode adapter', () => {
    const profiles = buildProfiles('vendor/team/apex-v1', '/tmp/provider config.jsonc') as OpenCodeAgentProfile[];
    expect(profiles).toHaveLength(16);
    for (const [index, profile] of profiles.entries()) {
      expect(profile.id).toBe(SCENARIO.roles[index].id);
      expect(profile.label).toContain(`P${String(index + 1).padStart(2, '0')}`);
      const launch = buildOpenCodeLaunchConfig(profile, profile.args!, profile.env!);
      expect(launch.configurationError).toBeUndefined();
      expect(launch.args).toEqual(['--model', 'vendor/team/apex-v1', '--agent', `commander-${profile.id}`]);
      expect(launch.env.OPENCODE_CONFIG).toBe('/tmp/provider config.jsonc');
      const inline = JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT);
      expect(inline).toMatchObject({
        model: 'vendor/team/apex-v1', small_model: 'vendor/team/apex-v1',
        enabled_providers: ['vendor'], share: 'disabled', autoupdate: false,
      });
      expect(inline.provider).toBeUndefined(); // No copied provider credentials.
      const role = inline.agent[profile.agent!];
      expect(role.mode).toBe('primary');
      expect(role.model).toBe(profile.model);
      for (const tool of ['*', 'edit', 'bash', 'task', 'read', 'webfetch', 'external_directory']) {
        expect(role.permission[tool]).toBe('deny');
      }
      expect(Object.keys(profile.env!)).toEqual(['OPENCODE_CONFIG_CONTENT']);
      expect(role.prompt).not.toContain('===COMMANDER:'); // No static capability-bearing frames.
    }
  });

  it.each([
    '', 'apex', '/apex', 'provider/', '-provider/apex', 'provider/model name',
    'provider/apex\n', 'provider/$(id)', 'provider/apex;echo', 'PROVIDER/EXACT_MODEL_ID',
    'provider/model-name', 'provider/<model>',
  ])('rejects missing, malformed or placeholder selector %j', (model) => {
    expect(() => validateModel(model)).toThrow('explicit APEX');
  });

  it('requires all CLI options once and supports read-only help', () => {
    expect(parseArguments(['--help'])).toEqual({ help: true });
    expect(parseArguments(['--model', 'vendor/apex', '--opencode-config', '/tmp/provider.json', '--out', '/tmp/new'])).toEqual({
      model: 'vendor/apex', configPath: '/tmp/provider.json', out: '/tmp/new',
    });
    for (const args of [[], ['--model'], ['--model', 'vendor/apex'], ['--unknown', 'x'],
      ['--model', 'a/b', '--model', 'c/d'], ['--out', '--help']]) {
      expect(() => parseArguments(args)).toThrow();
    }
  });

  it('creates only private new output, preserving the opaque provider config', async () => {
    const options = await fixture();
    const read = vi.spyOn(fs, 'readFile');
    const result = await prepareShowcase(options);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(result).toMatchObject({ profiles: 16, liveModelVerified: false, waves: SCENARIO.waves });
    expect((await fs.stat(options.out)).mode & 0o777).toBe(0o700);
    expect(await fs.readFile(options.configPath, 'utf8')).toContain('PRIVATE_PROVIDER_SENTINEL_DO_NOT_COPY');
    expect((await fs.readdir(options.root)).sort()).toEqual(['new showcase', 'provider config.jsonc']);
    for (const file of result.files) {
      expect((await fs.stat(path.join(options.out, file))).mode & 0o777).toBe(0o600);
      expect(await fs.readFile(path.join(options.out, file), 'utf8')).not.toContain('PRIVATE_PROVIDER_SENTINEL_DO_NOT_COPY');
    }
    expect((await fs.readFile(path.join(options.out, 'start.txt'), 'utf8')).trim()).toBe(SCENARIO.startPrompt);
    for (let wave = 2; wave <= 7; wave++) {
      expect(await fs.readFile(path.join(options.out, `continue-wave-${wave}.txt`), 'utf8')).toBe(`CONTINUE APEX WAVE ${wave}\n`);
    }
    const scenario = JSON.parse(await fs.readFile(path.join(options.out, 'scenario.json'), 'utf8'));
    expect(scenario).toMatchObject({ modelIdentity: 'declared-by-user', liveModelVerified: false });
    const generated = JSON.parse(await fs.readFile(path.join(options.out, 'commander-profiles.json'), 'utf8'));
    expect(Object.keys(generated)).toEqual(['agentProfiles']);
    expect(generated.agentProfiles).toHaveLength(16);
  });

  it.each(['directory', 'file', 'symlink'])('refuses an existing output %s without changing it', async (kind) => {
    const options = await fixture();
    if (kind === 'directory') await fs.mkdir(options.out);
    else if (kind === 'file') await fs.writeFile(options.out, 'KEEP');
    else await fs.symlink(options.configPath, options.out);
    const before = await fs.lstat(options.out);
    await expect(prepareShowcase(options)).rejects.toThrow('Output already exists');
    expect((await fs.lstat(options.out)).ino).toBe(before.ino);
    if (kind === 'file') expect(await fs.readFile(options.out, 'utf8')).toBe('KEEP');
    if (kind === 'directory') expect(await fs.readdir(options.out)).toEqual([]);
    expect(await fs.readFile(options.configPath, 'utf8')).toContain('PRIVATE_PROVIDER_SENTINEL_DO_NOT_COPY');
  });

  it('rejects missing/non-file provider config and invalid paths before creating output', async () => {
    const options = await fixture();
    for (const configPath of [path.join(options.root, 'missing'), options.root]) {
      await expect(prepareShowcase({ ...options, configPath })).rejects.toThrow('readable regular file');
    }
    for (const key of ['configPath', 'out']) {
      for (const value of ['./relative', '/tmp/with\ncontrol']) {
        await expect(prepareShowcase({ ...options, [key]: value })).rejects.toThrow('absolute path');
      }
    }
    await expect(fs.stat(options.out)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('has an independently runnable offline CLI with clear missing-model failure', () => {
    const cli = path.resolve('Example/apex-sixteen-panel/prepare.mjs');
    const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000 });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('sixteen-panel');
    const absent = spawnSync(process.execPath, [cli], { encoding: 'utf8', timeout: 5000 });
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain('Missing --model');
    expect(absent.stdout).toBe('');
  });
});
