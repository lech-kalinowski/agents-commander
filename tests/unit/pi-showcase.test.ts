import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPiProfiles, parseArguments, preparePiShowcase, requireSupportedNode, validateBaseUrl, validatePiModel, validateMaxTokens, validateContextWindow } from '../../Example/apex-sixteen-panel/prepare-pi.mjs';
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
        models: [{ id: options.model, name: 'APEX', contextWindow: 245760, maxTokens: 131072, samplingParams: { tool_choice: 'none' } }],
      });
      expect(JSON.parse(await fs.readFile(path.join(roleDir, 'settings.json'), 'utf8'))).toEqual({
        compaction: { enabled: false }, retry: { enabled: false, provider: { timeoutMs: 300000, maxRetries: 0 } },
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
    expect(help.stdout).toContain('--max-tokens');
    expect(help.stdout).toContain('--context-window');
    expect(help.stdout).toContain('--scenario');
  });

  it.each([
    { scenario: 'review-council', maxTokens: undefined, contextWindow: undefined, expected: 131072, expectedContext: 245760, count: 16 },
    { scenario: 'broadcast-test', maxTokens: undefined, contextWindow: undefined, expected: 131072, expectedContext: 245760, count: 3 },
    { scenario: 'review-council', maxTokens: 8192, contextWindow: 262144, expected: 8192, expectedContext: 262144, count: 16 },
    { scenario: 'broadcast-test', maxTokens: '4096', contextWindow: '16384', expected: 4096, expectedContext: 16384, count: 3 },
    { scenario: 'review-council', maxTokens: 131072, contextWindow: 135168, expected: 131072, expectedContext: 135168, count: 16 },
    { scenario: 'broadcast-test', maxTokens: undefined, contextWindow: 8192, expected: 4096, expectedContext: 8192, count: 3 },
    { scenario: 'review-council', maxTokens: undefined, contextWindow: 32768, expected: 28672, expectedContext: 32768, count: 16 },
    { scenario: 'broadcast-test', maxTokens: 256, contextWindow: 8192, expected: 256, expectedContext: 8192, count: 3 },
  ])('propagates $scenario output budget $maxTokens and context $contextWindow to every model and setup manifest', async ({ scenario, maxTokens, contextWindow, expected, expectedContext, count }) => {
    const options = await fixture();
    const read = vi.spyOn(fs, 'readFile');
    const result = await preparePiShowcase({ ...options, scenario, maxTokens, contextWindow });
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(result).toMatchObject({ scenario, profiles: count, configuredLimits: { contextWindow: expectedContext, maxTokens: expected }, liveModelVerified: false });
    const manifest = JSON.parse(await fs.readFile(path.join(options.out, 'scenario.json'), 'utf8'));
    expect(manifest).toMatchObject({ preparationScenario: scenario, configuredLimits: result.configuredLimits, liveModelVerified: false });
    const fragment = JSON.parse(await fs.readFile(path.join(options.out, 'commander-profiles.json'), 'utf8'));
    expect(fragment.agentProfiles).toEqual(buildPiProfiles({ ...options, scenario }));
    expect(fragment.agentProfiles).toHaveLength(count);
    for (const profile of fragment.agentProfiles) {
      expect(profile.args).toHaveLength(11); // Existing registration contract remains valid.
      const roleDir = path.join(options.out, 'roles', profile.id);
      const config = JSON.parse(await fs.readFile(path.join(roleDir, 'models.json'), 'utf8'));
      expect(config.providers.apex.models[0]).toMatchObject({ maxTokens: expected, contextWindow: expectedContext });
      expect(config.providers.apex.models[0].samplingParams).toEqual({ tool_choice: 'none' });
      const settings = JSON.parse(await fs.readFile(path.join(roleDir, 'settings.json'), 'utf8'));
      expect(settings.compaction.enabled).toBe(false);
      expect(settings.retry.enabled).toBe(false);
      expect(settings.retry.provider.maxRetries).toBe(0);
      expect(settings.retry.provider.timeoutMs).toBe(300000);
    }
    const setup = await fs.readFile(path.join(options.out, 'SETUP.txt'), 'utf8');
    expect(setup).toContain(`${expected} output-token ceiling`);
    expect(setup).toContain(`${expectedContext} context`);
    expect(setup).toContain('not universal provider capabilities or guaranteed response lengths');
    if (scenario === 'broadcast-test') {
      expect(setup).toContain('ALL other connected agents, including hidden panels');
      expect(fragment.agentProfiles.map((profile: { id: string }) => profile.id)).toEqual([
        'apex-pi-broadcast-sender', 'apex-pi-broadcast-receiver-1', 'apex-pi-broadcast-receiver-2',
      ]);
      expect(result.files.some((name: string) => name.startsWith('continue-wave-'))).toBe(false);
      expect(await fs.readFile(path.join(options.out, 'start.txt'), 'utf8')).toBe('START APEX BROADCAST\n');
    }
  });

  it.each([0, 255, 131073, NaN, Infinity, 2048.5, true, null, '', ' 8192', '8192 ', '+8192', '-8192', '8e3', '0x2000', '8192.0', '08192'])
  ('rejects invalid output budget %# before creating files', async (maxTokens) => {
    const options = await fixture();
    expect(() => validateMaxTokens(maxTokens)).toThrow('decimal integer');
    await expect(preparePiShowcase({ ...options, maxTokens })).rejects.toThrow('decimal integer');
    await expect(fs.stat(options.out)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([0, 8191, 262145, NaN, Infinity, 16384.5, true, null, '', ' 32768', '32768 ', '+32768', '-32768', '3e4', '0x8000', '32768.0', '032768'])
  ('rejects invalid context window %# before creating files', async (contextWindow) => {
    const options = await fixture();
    expect(() => validateContextWindow(contextWindow)).toThrow('decimal integer');
    await expect(preparePiShowcase({ ...options, contextWindow })).rejects.toThrow('decimal integer');
    await expect(fs.stat(options.out)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    { maxTokens: 4097, contextWindow: 8192 },
    { maxTokens: 8192, contextWindow: 8192 },
    { maxTokens: '131072', contextWindow: '131072' },
    { maxTokens: 131072, contextWindow: 135167 },
  ])('rejects output $maxTokens incompatible with context $contextWindow before reading inputs or writing output', async ({ maxTokens, contextWindow }) => {
    const options = await fixture();
    const read = vi.spyOn(fs, 'readFile');
    const mkdir = vi.spyOn(fs, 'mkdir');
    const write = vi.spyOn(fs, 'writeFile');
    await expect(preparePiShowcase({ ...options, maxTokens, contextWindow })).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    await expect(fs.stat(options.out)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts bounded integer budgets and validates optional CLI flags without making them required', async () => {
    const options = await fixture();
    for (const value of [256, '256', 131072, '131072', 8192, '8192']) expect(validateMaxTokens(value)).toBe(Number(value));
    for (const value of [8192, '8192', 262144, '262144', 245760, '245760']) expect(validateContextWindow(value)).toBe(Number(value));
    const args = ['--model', options.model, '--base-url', options.baseUrl, '--pi-entry', options.piEntry,
      '--credentials', options.credentials, '--out', options.out, '--scenario', 'broadcast-test', '--max-tokens', '4096', '--context-window', '32768'];
    expect(parseArguments(args)).toMatchObject({ scenario: 'broadcast-test', maxTokens: 4096, contextWindow: 32768 });
    for (const extra of [['--scenario', 'broadcast-test'], ['--max-tokens', '8192'], ['--context-window', '32768']]) {
      expect(() => parseArguments([...args, ...extra])).toThrow();
    }
    const requiredArgs = args.slice(0, 10);
    for (const flag of ['--max-tokens', '--context-window']) {
      for (const value of ['', ' 8192', '8192.0', '8e3', '08192']) {
        expect(() => parseArguments([...requiredArgs, flag, value])).toThrow();
      }
      expect(() => parseArguments([...requiredArgs, flag])).toThrow();
    }
    for (const scenario of ['', null, 'unknown', 'BROADCAST-TEST']) {
      await expect(preparePiShowcase({ ...options, scenario })).rejects.toThrow('scenario must be');
    }
    await expect(fs.stat(options.out)).rejects.toMatchObject({ code: 'ENOENT' });
    const run = spawnSync(process.execPath, [path.resolve('Example/apex-sixteen-panel/prepare-pi.mjs'), ...args], { encoding: 'utf8', timeout: 5000 });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toMatchObject({ profiles: 3, configuredLimits: { contextWindow: 32768, maxTokens: 4096 } });
    const scenario = JSON.parse(await fs.readFile(path.join(options.out, 'scenario.json'), 'utf8'));
    expect(scenario.configuredLimits).toEqual({ contextWindow: 32768, maxTokens: 4096 });
    const profiles = JSON.parse(await fs.readFile(path.join(options.out, 'commander-profiles.json'), 'utf8'));
    for (const profile of profiles.agentProfiles) {
      const model = JSON.parse(await fs.readFile(path.join(options.out, 'roles', profile.id, 'models.json'), 'utf8'));
      expect(model.providers.apex.models[0]).toMatchObject(scenario.configuredLimits);
    }
    expect(await fs.readFile(path.join(options.out, 'SETUP.txt'), 'utf8')).toContain('32768 context and 4096 output-token ceiling');
  });
});
