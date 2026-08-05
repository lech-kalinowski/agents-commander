import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { loadConfig, saveConfig } from '../../src/config/loader.js';
import { defaultConfig } from '../../src/config/defaults.js';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    chmodSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deep merges nested config overrides with defaults', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      editor: { wordWrap: false },
      agents: {
        codex: {
          args: ['--fast'],
        },
      },
    }) as never);

    const config = loadConfig();

    expect(config.editor).toEqual({
      tabSize: defaultConfig.editor.tabSize,
      wordWrap: false,
    });
    expect(config.agents.codex).toEqual({
      command: defaultConfig.agents.codex.command,
      args: ['--fast'],
      env: defaultConfig.agents.codex.env,
    });
    expect(config.agents.claude).toEqual(defaultConfig.agents.claude);
  });

  it('falls back to defaults for non-object config payloads', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('"invalid"' as never);

    expect(loadConfig()).toEqual(defaultConfig);
  });

  it('rejects invalid values instead of returning an unsafe typed config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      panelCount: 101,
      panelDensity: 'dense',
      showHidden: 'yes',
      sortBy: 'random',
      watchDebounce: -1,
      editor: { tabSize: 0, wordWrap: 'no' },
      agents: {
        codex: { command: '', args: 'fast', env: { VALID: 'yes', INVALID: 1 } },
      },
      orchestration: { ackTimeout: 'forever', maxContentLines: 0, maxContentBytes: 512 },
    }) as never);

    const config = loadConfig();

    expect(config.panelCount).toBe(defaultConfig.panelCount);
    expect(config.panelDensity).toBe(defaultConfig.panelDensity);
    expect(config.showHidden).toBe(defaultConfig.showHidden);
    expect(config.sortBy).toBe(defaultConfig.sortBy);
    expect(config.watchDebounce).toBe(defaultConfig.watchDebounce);
    expect(config.editor).toEqual(defaultConfig.editor);
    expect(config.agents.codex).toEqual({
      ...defaultConfig.agents.codex,
      env: { VALID: 'yes' },
    });
    expect(config.orchestration).toEqual(defaultConfig.orchestration);
  });

  it.each([1, 100])('accepts the active panel-count boundary %i', (panelCount) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      panelCount,
      panelDensity: 'auto',
    }) as never);

    const config = loadConfig();

    expect(config.panelCount).toBe(panelCount);
    expect(config.panelDensity).toBe('auto');
  });

  it.each([0, 101, 1.5])('rejects invalid active panel count %s', (panelCount) => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ panelCount }) as never);

    expect(loadConfig().panelCount).toBe(defaultConfig.panelCount);
  });

  it('migrates a legacy 2/3/4 panel count to the matching density preset', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ panelCount: 3 }) as never);

    expect(loadConfig()).toMatchObject({
      panelCount: 3,
      panelDensity: 3,
    });
  });

  it('returns fresh nested defaults on every load', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const first = loadConfig();
    first.editor.tabSize = 8;
    first.agents.codex.args.push('--changed');

    const second = loadConfig();
    expect(second.editor.tabSize).toBe(defaultConfig.editor.tabSize);
    expect(second.agents.codex.args).toEqual(defaultConfig.agents.codex.args);
  });

  it('migrates legacy agent overrides and normalizes named OpenCode profiles', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      agents: {
        opencode: {
          command: '  opencode  ',
          args: ['--log-level', 'WARN'],
          env: { VALID_TOKEN: 'secret', 'INVALID-KEY': 'discarded' },
        },
      },
      agentProfiles: [{
        id: 'local-qwen',
        label: 'Local Qwen',
        adapter: 'opencode',
        model: 'ollama/qwen3-coder',
        agent: 'reviewer',
        configPath: '/tmp/opencode.json',
      }],
    }) as never);

    const config = loadConfig();

    expect(config.agents.opencode).toEqual({
      command: 'opencode',
      args: ['--log-level', 'WARN'],
      env: { VALID_TOKEN: 'secret' },
    });
    expect(config.agentProfiles.find((profile) => profile.id === 'local-qwen')).toEqual({
      id: 'local-qwen',
      label: 'Local Qwen',
      adapter: 'opencode',
      model: 'ollama/qwen3-coder',
      agent: 'reviewer',
      configPath: '/tmp/opencode.json',
    });
    expect(config.agentProfiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['claude', 'codex', 'gemini', 'opencode', 'generic']),
    );
  });

  it('retains explicit malformed profile fields as an unlaunchable configuration error', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      agentProfiles: [{
        id: 'broken',
        label: 'Broken',
        adapter: 'opencode',
        model: 42,
        args: '--unsafe',
        configPath: './relative.json',
      }],
    }) as never);

    const profile = loadConfig().agentProfiles.find((entry) => entry.id === 'broken');
    expect(profile).toMatchObject({
      id: 'broken',
      adapter: 'opencode',
      configurationError: expect.stringMatching(/model|args|absolute/u),
    });
  });

  it('keeps malformed canonical profile identities unlaunchable instead of falling back', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      agentProfiles: [{
        id: 'opencode',
        label: 'Unsafe\u0007label',
        adapter: 'not-an-adapter',
        model: 'ollama/qwen3-coder',
      }],
    }) as never);

    const profile = loadConfig().agentProfiles.find((entry) => entry.id === 'opencode');
    expect(profile).toMatchObject({
      id: 'opencode',
      label: 'OpenCode',
      adapter: 'opencode',
      configurationError: expect.stringMatching(/label.*adapter/u),
    });
  });

  it('writes configuration atomically with private directory and file modes', () => {
    saveConfig(structuredClone(defaultConfig));

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.agents-commander'),
      { recursive: true, mode: 0o700 },
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.config\.\d+\.\d+\.tmp$/u),
      expect.any(String),
      { encoding: 'utf-8', mode: 0o600, flag: 'wx' },
    );
    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/u),
      expect.stringMatching(/config\.json$/u),
    );
    expect(fs.chmodSync).toHaveBeenCalledWith(
      expect.stringMatching(/config\.json$/u),
      0o600,
    );
  });
});
