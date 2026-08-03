import { describe, expect, it, vi } from 'vitest';
import { AgentManager } from '../../src/agents/agent-manager.js';
import { discoverAgents, getAgentInfo } from '../../src/agents/agent-registry.js';
import {
  buildOpenCodeLaunchConfig,
  validateOpenCodeModel,
} from '../../src/agents/opencode-adapter.js';
import type { OpenCodeAgentProfile } from '../../src/agents/types.js';

const profile: OpenCodeAgentProfile = {
  id: 'local-reviewer',
  label: 'Local Reviewer',
  adapter: 'opencode',
  model: 'lmstudio/google/gemma-3n-e4b',
  agent: 'reviewer',
  configPath: '/tmp/opencode profile.json',
};

describe('OpenCode agent profiles', () => {
  it('builds literal argv and maps configPath without mutating inputs', () => {
    const args = ['--log-level', 'WARN'];
    const env = { OPENCODE_CONFIG: '/legacy.json', PROVIDER_TOKEN: 'secret' };

    const result = buildOpenCodeLaunchConfig(profile, args, env);

    expect(result).toEqual({
      args: [
        '--log-level',
        'WARN',
        '--model',
        'lmstudio/google/gemma-3n-e4b',
        '--agent',
        'reviewer',
      ],
      env: {
        OPENCODE_CONFIG: '/tmp/opencode profile.json',
        PROVIDER_TOKEN: 'secret',
      },
    });
    expect(args).toEqual(['--log-level', 'WARN']);
    expect(env.OPENCODE_CONFIG).toBe('/legacy.json');
  });

  it('validates full provider/model strings and conflicting managed flags', () => {
    expect(validateOpenCodeModel('openrouter/anthropic/claude-sonnet')).toBeNull();
    expect(validateOpenCodeModel('claude-sonnet')).toContain('provider/model');

    expect(buildOpenCodeLaunchConfig(profile, ['--model', 'other/model'], {}))
      .toMatchObject({
        configurationError: expect.stringContaining('conflicts'),
      });
    expect(buildOpenCodeLaunchConfig({
      ...profile,
      configPath: './relative.json',
    }, [], {})).toMatchObject({
      configurationError: expect.stringContaining('absolute'),
    });
  });

  it('does not pick an arbitrary named profile as the adapter default', () => {
    expect(getAgentInfo('opencode', undefined, [profile])).toBeUndefined();
  });

  it('layers named profile values over legacy adapter overrides', () => {
    const agents = discoverAgents({
      opencode: {
        command: process.execPath,
        args: ['--log-level', 'INFO'],
        env: { LEGACY_VALUE: 'base' },
      },
    }, [{
      ...profile,
      args: ['--log-level', 'WARN'],
      env: { PROFILE_VALUE: 'named' },
    }]);

    expect(agents).toEqual([
      expect.objectContaining({
        type: 'opencode',
        profileId: 'local-reviewer',
        profileLabel: 'Local Reviewer',
        name: 'Local Reviewer',
        installed: true,
        supported: true,
        model: profile.model,
        args: [
          '--log-level',
          'WARN',
          '--model',
          profile.model,
          '--agent',
          'reviewer',
        ],
        env: {
          LEGACY_VALUE: 'base',
          PROFILE_VALUE: 'named',
          OPENCODE_CONFIG: profile.configPath,
        },
      }),
    ]);
  });

  it('launches and reports the selected profile identity', () => {
    const manager = new AgentManager({
      opencode: { command: process.execPath, args: [], env: {} },
    }, [profile]);
    const panel = {
      panelIndex: 0,
      isRunning: false,
      workingDir: '/tmp',
      status: 'idle',
      onExit: null,
      killAgent: vi.fn(),
      launchAgent: vi.fn().mockImplementation(() => {
        panel.isRunning = true;
        panel.status = 'running';
        return true;
      }),
    };

    expect(manager.launchProfile('local-reviewer', panel as never)).toBe(true);
    expect(panel.launchAgent).toHaveBeenCalledWith(
      'opencode',
      'Local Reviewer',
      process.execPath,
      ['--model', profile.model, '--agent', 'reviewer'],
      { OPENCODE_CONFIG: profile.configPath },
    );
    expect(manager.getRunningAgents()).toEqual([
      expect.objectContaining({
        type: 'opencode',
        profileId: 'local-reviewer',
        profileLabel: 'Local Reviewer',
        model: profile.model,
      }),
    ]);
    expect(manager.getAgentProfileId(0)).toBe('local-reviewer');
  });

  it('rejects an invalid profile before replacing an existing session', () => {
    const manager = new AgentManager({
      opencode: { command: process.execPath, args: [], env: {} },
    }, [{
      ...profile,
      model: 'missing-provider-prefix',
    }]);
    const panel = {
      panelIndex: 0,
      isRunning: true,
      workingDir: '/tmp',
      status: 'running',
      onExit: null,
      killAgent: vi.fn(),
      launchAgent: vi.fn(),
    };

    expect(manager.getProfileLaunchError('local-reviewer')).toContain('provider/model');
    expect(manager.launchProfile('local-reviewer', panel as never)).toBe(false);
    expect(panel.killAgent).not.toHaveBeenCalled();
    expect(panel.launchAgent).not.toHaveBeenCalled();
  });

  it('rejects a profile when routing claims a different adapter', () => {
    const manager = new AgentManager({
      opencode: { command: process.execPath, args: [], env: {} },
    }, [profile]);

    expect(manager.getProfileLaunchError('local-reviewer', 'codex')).toBe(
      'Agent profile local-reviewer uses opencode, not codex',
    );
  });
});
