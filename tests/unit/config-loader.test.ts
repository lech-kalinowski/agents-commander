import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { loadConfig } from '../../src/config/loader.js';
import { defaultConfig } from '../../src/config/defaults.js';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
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
      panelCount: 99,
      showHidden: 'yes',
      sortBy: 'random',
      watchDebounce: -1,
      editor: { tabSize: 0, wordWrap: 'no' },
      agents: {
        codex: { command: '', args: 'fast', env: { VALID: 'yes', INVALID: 1 } },
      },
      orchestration: { ackTimeout: 'forever', maxContentLines: 0 },
    }) as never);

    const config = loadConfig();

    expect(config.panelCount).toBe(defaultConfig.panelCount);
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

  it('returns fresh nested defaults on every load', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const first = loadConfig();
    first.editor.tabSize = 8;
    first.agents.codex.args.push('--changed');

    const second = loadConfig();
    expect(second.editor.tabSize).toBe(defaultConfig.editor.tabSize);
    expect(second.agents.codex.args).toEqual(defaultConfig.agents.codex.args);
  });
});
