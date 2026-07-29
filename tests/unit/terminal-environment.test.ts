import { describe, expect, it, vi } from 'vitest';
import {
  buildTerminalSpawnEnvironment,
  TerminalPanel,
} from '../../src/panels/terminal-panel.js';

describe('internal terminal environment policy', () => {
  it('keeps only terminal/display allowlist values and strips credential material', () => {
    const inherited = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/demo',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TERM: 'screen',
      COLORTERM: 'truecolor',
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      XDG_RUNTIME_DIR: '/run/user/1000',
      OPENAI_API_KEY: 'openai-secret',
      ANTHROPIC_API_KEY: 'anthropic-secret',
      GITHUB_TOKEN: 'github-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GOOGLE_APPLICATION_CREDENTIALS: '/credentials.json',
      SAFE_BUT_UNNEEDED: 'remove-me',
    };

    const result = buildTerminalSpawnEnvironment(inherited, {
      PATH: '/demo/bin',
      LC_CTYPE: 'C.UTF-8',
      DEMO_TOKEN: 'override-secret',
      CUSTOM_VALUE: 'remove-me-too',
    }, {
      policy: 'internal',
      cwd: '/tmp/demo',
      cols: 100,
      rows: 30,
    });

    expect(result).toEqual({
      PATH: '/demo/bin',
      HOME: '/Users/demo',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'C.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      XDG_RUNTIME_DIR: '/run/user/1000',
      FORCE_COLOR: '1',
      COLUMNS: '100',
      LINES: '30',
      PWD: '/tmp/demo',
    });
    expect(Object.values(result)).not.toContain('openai-secret');
    expect(Object.values(result)).not.toContain('override-secret');
  });

  it('retains the current inherited behavior for normal external agents', () => {
    const result = buildTerminalSpawnEnvironment({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'normal-agent-secret',
      CUSTOM_VALUE: 'inherited',
    }, {
      CUSTOM_VALUE: 'overridden',
      AGENT_TOKEN: 'configured-token',
    }, {
      policy: 'inherit',
      cwd: '/work',
      cols: 80,
      rows: 24,
    });

    expect(result).toMatchObject({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'normal-agent-secret',
      CUSTOM_VALUE: 'overridden',
      AGENT_TOKEN: 'configured-token',
      TERM: 'xterm-256color',
      FORCE_COLOR: '1',
      COLUMNS: '80',
      LINES: '24',
      PWD: '/work',
    });
  });

  it('selects scanner-enabled minimal policy for internal launches', () => {
    const panel = Object.assign(Object.create(TerminalPanel.prototype), {
      proc: null,
      agentType: null,
      agentName: '',
      _status: 'idle',
      launchSealed: false,
      initVTerm: vi.fn(),
      exitHandler: null,
      userScrolled: true,
      launchSession: vi.fn().mockReturnValue(true),
    });

    expect(TerminalPanel.prototype.launchInternalAgent.call(
      panel,
      'Demo Coordinator',
      process.execPath,
      ['/demo/demo-agent.js', '--role', 'coordinator'],
      {},
    )).toBe(true);

    expect(panel.agentType).toBe('generic');
    expect(panel.agentName).toBe('Demo Coordinator');
    expect(panel.launchSession).toHaveBeenCalledWith(
      process.execPath,
      ['/demo/demo-agent.js', '--role', 'coordinator'],
      {},
      true,
      'internal',
    );
  });
});
