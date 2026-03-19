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
});
