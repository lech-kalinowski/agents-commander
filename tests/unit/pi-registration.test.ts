import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPiProfiles } from '../../Example/apex-sixteen-panel/prepare-pi.mjs';
import { parseArguments, registerPiProfiles } from '../../Example/apex-sixteen-panel/register-pi.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commander-pi-registration-'));
  roots.push(root);
  const profilesPath = path.join(root, 'commander-profiles.json');
  const configPath = path.join(root, 'commander', 'config.json');
  // Paths are opaque. Registration needs no credential file or live Pi installation.
  const profiles = buildPiProfiles({ model: 'test/apex-v1', piEntry: path.join(root, 'pi.js'),
    credentials: path.join(root, 'credential-file-does-not-exist'), out: path.join(root, 'showcase') });
  await fs.writeFile(profilesPath, JSON.stringify({ agentProfiles: profiles }));
  return { root, profilesPath, configPath, profiles };
}

describe('explicit APEX Pi profile registration', () => {
  it('creates private configuration with sixteen generated profiles without opening credentials', async () => {
    const options = await fixture();
    expect(await registerPiProfiles(options)).toEqual({ configPath: options.configPath,
      added: 16, unchanged: 0, backupPath: null });
    expect(JSON.parse(await fs.readFile(options.configPath, 'utf8'))).toEqual({ agentProfiles: options.profiles });
    expect((await fs.stat(path.dirname(options.configPath))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(options.configPath)).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(path.dirname(options.configPath))).toEqual(['config.json']);
  });

  it('registers broadcast profiles alongside the unchanged sixteen-role council', async () => {
    const options = await fixture();
    await registerPiProfiles(options);
    const broadcast = buildPiProfiles({ model: 'test/apex-v1', piEntry: path.join(options.root, 'pi.js'),
      credentials: path.join(options.root, 'credential-file-does-not-exist'), out: path.join(options.root, 'broadcast'), scenario: 'broadcast-test' });
    await fs.writeFile(options.profilesPath, JSON.stringify({ agentProfiles: broadcast }));
    expect(await registerPiProfiles(options)).toMatchObject({ added: 3, unchanged: 0 });
    const config = JSON.parse(await fs.readFile(options.configPath, 'utf8'));
    expect(config.agentProfiles).toEqual([...options.profiles, ...broadcast]);
    expect(await registerPiProfiles(options)).toMatchObject({ added: 0, unchanged: 3, backupPath: null });
  });

  it('preserves unrelated settings/profiles, backs up exact bytes privately and reruns without writes', async () => {
    const options = await fixture();
    const unrelated = { id: 'my-codex', label: 'My Codex', adapter: 'codex', args: ['--no-alt-screen'] };
    const existing = { theme: 'retro', orchestration: { maxContentBytes: 12345 },
      customFutureSetting: { enabled: true }, agentProfiles: [unrelated] };
    const originalBytes = Buffer.from(`${JSON.stringify(existing)}\n\n`);
    await fs.mkdir(path.dirname(options.configPath));
    await fs.writeFile(options.configPath, originalBytes);
    const result = await registerPiProfiles(options);
    expect(result.added).toBe(16);
    expect(result.backupPath).toMatch(/config\.json\.backup-/u);
    expect(await fs.readFile(result.backupPath!)).toEqual(originalBytes);
    expect((await fs.stat(result.backupPath!)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(options.configPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await fs.readFile(options.configPath, 'utf8'))).toEqual({
      ...existing, agentProfiles: [unrelated, ...options.profiles],
    });
    const contents = await fs.readFile(options.configPath);
    const stat = await fs.stat(options.configPath);
    const files = await fs.readdir(path.dirname(options.configPath));
    expect(await registerPiProfiles(options)).toMatchObject({ added: 0, unchanged: 16, backupPath: null });
    expect(await fs.readFile(options.configPath)).toEqual(contents);
    expect((await fs.stat(options.configPath)).mtimeMs).toBe(stat.mtimeMs);
    expect(await fs.readdir(path.dirname(options.configPath))).toEqual(files);
  });

  it('rejects different settings under an existing ID without adding profiles or backups', async () => {
    const options = await fixture();
    await fs.mkdir(path.dirname(options.configPath));
    const bytes = JSON.stringify({ agentProfiles: [{ ...options.profiles[0], label: 'Keep my changed role' }] });
    await fs.writeFile(options.configPath, bytes);
    await expect(registerPiProfiles(options)).rejects.toThrow('already exists with different settings');
    expect(await fs.readFile(options.configPath, 'utf8')).toBe(bytes);
    expect(await fs.readdir(path.dirname(options.configPath))).toEqual(['config.json']);
  });

  it.each(['unrelated ID', 'wrong adapter', 'shell command', 'wrong wrapper', 'missing option', 'extra option', 'relative path', 'extra env', 'duplicate ID'])
  ('rejects %s in the incoming fragment before creating configuration', async (kind) => {
    const options = await fixture();
    const profile = { ...options.profiles[0], args: [...options.profiles[0].args] } as Record<string, any>;
    if (kind === 'unrelated ID') profile.id = 'codex';
    if (kind === 'wrong adapter') profile.adapter = 'opencode';
    if (kind === 'shell command') profile.command = '/bin/sh';
    if (kind === 'wrong wrapper') profile.args[0] = '/tmp/other-wrapper.mjs';
    if (kind === 'missing option') profile.args.splice(1, 2);
    if (kind === 'extra option') profile.args.push('--smoke');
    if (kind === 'relative path') profile.args[2] = 'relative-pi-entry.js';
    if (kind === 'extra env') profile.env = { APEX_API_KEY: 'DO_NOT_WRITE' };
    await fs.writeFile(options.profilesPath, JSON.stringify({ agentProfiles: kind === 'duplicate ID' ? [profile, profile] : [profile] }));
    await expect(registerPiProfiles(options)).rejects.toThrow();
    await expect(fs.stat(path.dirname(options.configPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['invalid JSON', 'array config', 'malformed profiles', 'duplicate existing IDs'])
  ('rejects %s without replacing configuration', async (kind) => {
    const options = await fixture();
    await fs.mkdir(path.dirname(options.configPath));
    const bytes = kind === 'invalid JSON' ? '{ PRIVATE_CONFIG_DO_NOT_PRINT'
      : kind === 'array config' ? '[]'
        : kind === 'malformed profiles' ? '{"agentProfiles":[{"id":"bad"}]}'
          : JSON.stringify({ agentProfiles: [options.profiles[0], options.profiles[0]] });
    await fs.writeFile(options.configPath, bytes);
    await expect(registerPiProfiles(options)).rejects.toThrow();
    expect(await fs.readFile(options.configPath, 'utf8')).toBe(bytes);
    expect(await fs.readdir(path.dirname(options.configPath))).toEqual(['config.json']);
  });

  it.each(['symlink', 'directory'])('rejects a %s target and preserves it', async (kind) => {
    const options = await fixture();
    await fs.mkdir(path.dirname(options.configPath));
    if (kind === 'symlink') await fs.symlink(options.profilesPath, options.configPath);
    else await fs.mkdir(options.configPath);
    const before = await fs.lstat(options.configPath);
    await expect(registerPiProfiles(options)).rejects.toThrow('regular files');
    expect((await fs.lstat(options.configPath)).ino).toBe(before.ino);
  });

  it('preserves the original and its backup if atomic replacement fails', async () => {
    const options = await fixture();
    await fs.mkdir(path.dirname(options.configPath));
    const original = '{"theme":"keep this"}\n';
    await fs.writeFile(options.configPath, original);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));
    await expect(registerPiProfiles(options)).rejects.toThrow('simulated rename failure');
    expect(await fs.readFile(options.configPath, 'utf8')).toBe(original);
    const files = await fs.readdir(path.dirname(options.configPath));
    expect(files).toHaveLength(2);
    const backup = files.find((name) => name.startsWith('config.json.backup-'))!;
    expect(await fs.readFile(path.join(path.dirname(options.configPath), backup), 'utf8')).toBe(original);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it.each(['write', 'sync'])('cleans partial temporary output after a %s failure and preserves the original error', async (operation) => {
    const options = await fixture();
    await fs.mkdir(path.dirname(options.configPath));
    const original = '{"theme":"keep the original"}\n';
    await fs.writeFile(options.configPath, original);
    const failure = new Error(`simulated ${operation} failure`);
    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (typeof args[0] === 'string' && args[0].endsWith('.tmp')) {
        if (operation === 'write') {
          const originalWrite = handle.writeFile.bind(handle);
          vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
            await originalWrite('partial configuration');
            throw failure;
          });
        } else vi.spyOn(handle, 'sync').mockRejectedValueOnce(failure);
      }
      return handle;
    });
    await expect(registerPiProfiles(options)).rejects.toBe(failure);
    expect(await fs.readFile(options.configPath, 'utf8')).toBe(original);
    expect(await fs.readdir(path.dirname(options.configPath))).toEqual(['config.json']);
  });

  it('does not overwrite configuration created by another writer during first registration', async () => {
    const options = await fixture();
    const originalLink = fs.link.bind(fs);
    const concurrent = '{"theme":"created concurrently"}\n';
    vi.spyOn(fs, 'link').mockImplementationOnce(async (source, target) => {
      await fs.writeFile(target, concurrent, { flag: 'wx' });
      return originalLink(source, target);
    });
    await expect(registerPiProfiles(options)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(options.configPath, 'utf8')).toBe(concurrent);
    expect(await fs.readdir(path.dirname(options.configPath))).toEqual(['config.json']);
  });

  it('requires explicit input, rejects repeated flags and reports malformed JSON without contents', async () => {
    expect(parseArguments(['--help'])).toEqual({ help: true });
    expect(parseArguments(['--profiles', '/tmp/profiles.json', '--config', '/tmp/config.json'])).toEqual({
      profilesPath: '/tmp/profiles.json', configPath: '/tmp/config.json',
    });
    for (const args of [[], ['--profiles'], ['--profiles', '/tmp/p', '--profiles', '/tmp/q'], ['--unknown', 'x']]) {
      expect(() => parseArguments(args)).toThrow();
    }
    const options = await fixture();
    await fs.writeFile(options.profilesPath, '{ PRIVATE_SENTINEL_DO_NOT_PRINT');
    const result = spawnSync(process.execPath, [path.resolve('Example/apex-sixteen-panel/register-pi.mjs'),
      '--profiles', options.profilesPath, '--config', options.configPath], { encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not valid JSON');
    expect(result.stderr + result.stdout).not.toContain('PRIVATE_SENTINEL_DO_NOT_PRINT');
  });
});
