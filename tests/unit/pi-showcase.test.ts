import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPiProfiles, parseArguments, preparePiShowcase, requireSupportedNode, validateBaseUrl, validatePiModel } from '../../Example/apex-sixteen-panel/prepare-pi.mjs';
import { SCENARIO } from '../../Example/apex-sixteen-panel/scenario.mjs';
import { loadConfig } from '../../src/config/loader.js';
import { discoverAgentsWithResolver } from '../../src/agents/agent-registry.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-pi-example-'));
  roots.push(root);
  const credentials = path.join(root, 'private credentials');
  const piEntry = path.join(root, 'Pi cli.js');
  await fs.writeFile(credentials, 'PRIVATE_PI_SENTINEL_DO_NOT_COPY\nnot parsed during preparation', { mode: 0o600 });
  await fs.writeFile(piEntry, 'throw new Error("PI_ENTRY_MUST_NOT_EXECUTE");');
  return { root, credentials, piEntry, out: path.join(root, 'new showcase'), model: 'callstack/Apex-20260831', baseUrl: 'https://apex.example/v1' };
}

describe('offline sixteen-panel APEX Pi preparation', () => {
  it('preserves literal launch arguments through Commander normalization and discovery', async () => {
    const options = await fixture();
    const profiles = buildPiProfiles(options);
    vi.spyOn(syncFs, 'existsSync').mockReturnValue(true);
    vi.spyOn(syncFs, 'readFileSync').mockReturnValue(JSON.stringify({ agentProfiles: profiles }));
    const normalized = loadConfig();
    vi.restoreAllMocks();
    const selected = normalized.agentProfiles.filter((profile) => profile.id.startsWith('apex-pi-'));
    const discovered = discoverAgentsWithResolver(normalized.agents, selected, (command) => command === process.execPath ? command : null);
    expect(discovered).toHaveLength(16);
    expect(new Set(discovered.map((agent) => agent.profileId)).size).toBe(16);
    for (const [index, agent] of discovered.entries()) {
      const profile = profiles[index];
      expect(agent).toMatchObject({ type: 'generic', installed: true, supported: true, command: process.execPath, args: profile.args });
      expect(agent.configurationError).toBeUndefined();
      expect(profile.id).toBe(SCENARIO.roles[index].id.replace(/^apex-/u, 'apex-pi-'));
      expect(profile.label).toContain(`APEX Pi P${String(index + 1).padStart(2, '0')}`);
      expect(profile.args).toEqual([
        path.resolve('Example/apex-sixteen-panel/pi-runtime.mjs'), '--entry', options.piEntry,
        '--agent-dir', path.join(options.out, 'roles', profile.id), '--credentials', options.credentials,
        '--model', options.model, '--prompt', path.join(options.out, 'roles', profile.id, 'prompt.md'),
      ]);
      for (const key of ['model', 'agent', 'configPath', 'env']) expect(profile).not.toHaveProperty(key);
    }
  });

  it('writes private isolated model configurations and prompts without reading either input file', async () => {
    const options = await fixture();
    const read = vi.spyOn(fs, 'readFile');
    const result = await preparePiShowcase(options);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(result).toMatchObject({ profiles: 16, waves: SCENARIO.waves, liveModelVerified: false });
    expect((await fs.stat(options.out)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(options.out, 'roles'))).mode & 0o777).toBe(0o700);
    for (const name of result.files) {
      const generated = path.join(options.out, name);
      expect((await fs.stat(generated)).mode & 0o777).toBe(0o600);
      expect(await fs.readFile(generated, 'utf8')).not.toContain('PRIVATE_PI_SENTINEL_DO_NOT_COPY');
    }
    const profiles = JSON.parse(await fs.readFile(path.join(options.out, 'commander-profiles.json'), 'utf8'));
    expect(Object.keys(profiles)).toEqual(['agentProfiles']);
    for (const profile of profiles.agentProfiles) {
      const roleDir = path.join(options.out, 'roles', profile.id);
      expect((await fs.stat(roleDir)).mode & 0o777).toBe(0o700);
      const config = JSON.parse(await fs.readFile(path.join(roleDir, 'models.json'), 'utf8'));
      expect(Object.keys(config.providers)).toEqual(['apex']);
      expect(config.providers.apex).toEqual({
        baseUrl: options.baseUrl, api: 'openai-completions', apiKey: '$APEX_API_KEY',
        compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens' },
        models: [{ id: options.model, name: 'APEX', contextWindow: 32768, maxTokens: 2048, samplingParams: { tool_choice: 'none' } }],
      });
      expect(JSON.parse(await fs.readFile(path.join(roleDir, 'settings.json'), 'utf8'))).toEqual({
        compaction: { enabled: false }, retry: { enabled: false, provider: { timeoutMs: 60000, maxRetries: 0 } },
      });
      const prompt = await fs.readFile(path.join(roleDir, 'prompt.md'), 'utf8');
      expect(prompt).toContain(SCENARIO.brief);
      expect(prompt).not.toContain('===COMMANDER:');
      if (profile.id === 'apex-pi-coordinator') {
        expect(prompt).toContain('SEND to adapter generic');
        expect(prompt).not.toContain('adapter opencode');
      }
    }
    const start = await fs.readFile(path.join(options.out, 'start.txt'), 'utf8');
    expect(start.trim()).toContain('APEX/Pi');
    expect(start.trim()).not.toMatch(/[\r\n]/u);
    expect(start).not.toContain('OpenCode');
    for (let wave = 2; wave <= 7; wave++) expect(await fs.readFile(path.join(options.out, `continue-wave-${wave}.txt`), 'utf8')).toBe(`CONTINUE APEX WAVE ${wave}\n`);
    const scenario = JSON.parse(await fs.readFile(path.join(options.out, 'scenario.json'), 'utf8'));
    expect(scenario).toMatchObject({
      harness: 'pi', protocolAdapter: 'generic', model: options.model, baseUrl: options.baseUrl, liveModelVerified: false,
    });
    expect(scenario.startPrompt).toBe(start.trim());
    expect(scenario.evaluationChecklist).not.toContainEqual(expect.stringContaining('OpenCode'));
    expect(await fs.readFile(path.join(options.out, 'checklist.txt'), 'utf8')).toBe(`${scenario.evaluationChecklist.map((entry: string) => `- ${entry}`).join('\n')}\n`);
    expect(await fs.readFile(options.credentials, 'utf8')).toContain('PRIVATE_PI_SENTINEL_DO_NOT_COPY');
    expect((await fs.readdir(options.root)).sort()).toEqual(['Pi cli.js', 'new showcase', 'private credentials']);
  });

  it.each(['directory', 'file', 'symlink'])('preserves existing output %s without replacement', async (kind) => {
    const options = await fixture();
    if (kind === 'directory') await fs.mkdir(options.out);
    else if (kind === 'file') await fs.writeFile(options.out, 'KEEP');
    else await fs.symlink(options.credentials, options.out);
    const before = await fs.lstat(options.out);
    await expect(preparePiShowcase(options)).rejects.toThrow('Output already exists');
    expect((await fs.lstat(options.out)).ino).toBe(before.ino);
    if (kind === 'directory') expect(await fs.readdir(options.out)).toEqual([]);
    if (kind === 'file') expect(await fs.readFile(options.out, 'utf8')).toBe('KEEP');
    expect(await fs.readFile(options.credentials, 'utf8')).toContain('PRIVATE_PI_SENTINEL_DO_NOT_COPY');
  });

  it('rejects invalid destinations and missing/non-file inputs before creating output', async () => {
    const options = await fixture();
    for (const field of ['piEntry', 'credentials', 'out']) {
      for (const value of ['./relative', '/tmp/control\npath']) await expect(preparePiShowcase({ ...options, [field]: value })).rejects.toThrow('absolute path');
    }
    for (const field of ['piEntry', 'credentials']) {
      for (const value of [path.join(options.root, 'missing'), options.root]) await expect(preparePiShowcase({ ...options, [field]: value })).rejects.toThrow('readable regular file');
    }
    await expect(fs.stat(options.out)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires an exact model and HTTPS endpoint without URL credentials or parameters', () => {
    expect(validatePiModel('callstack/Apex-20260831')).toBe('callstack/Apex-20260831');
    for (const value of ['', '-apex', 'model name', 'apex\n', 'a/$(id)', 'EXACT_MODEL_ID']) expect(() => validatePiModel(value)).toThrow('explicit model');
    expect(validateBaseUrl('https://apex.example/v1/')).toBe('https://apex.example/v1');
    for (const value of ['http://apex.example', 'https://user:pass@apex.example', 'https://apex.example?key=private', 'https://apex.example#key', 'https://apex.example?', 'https://apex.example/\n', 'not a URL']) expect(() => validateBaseUrl(value)).toThrow('HTTPS');
    expect(() => requireSupportedNode('22.18.0')).toThrow('22.19');
    expect(() => requireSupportedNode('20.20.0')).toThrow('22.19');
    expect(() => requireSupportedNode('22.19.0')).not.toThrow();
    expect(() => requireSupportedNode('24.0.0')).not.toThrow();
  });

  it('requires every CLI argument exactly once and runs preparation without executing Pi', async () => {
    const options = await fixture();
    const args = ['--model', options.model, '--base-url', options.baseUrl, '--pi-entry', options.piEntry, '--credentials', options.credentials, '--out', options.out];
    expect(parseArguments(args)).toEqual({ model: options.model, baseUrl: options.baseUrl, piEntry: options.piEntry, credentials: options.credentials, out: options.out });
    expect(parseArguments(['--help'])).toEqual({ help: true });
    for (const invalid of [[], ['--unknown', 'x'], [...args, '--model', 'apex'], args.slice(0, -2)]) expect(() => parseArguments(invalid)).toThrow();
    const cli = path.resolve('Example/apex-sixteen-panel/prepare-pi.mjs');
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toMatchObject({ profiles: 16, liveModelVerified: false });
    const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000 });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--credentials');
  });
});
