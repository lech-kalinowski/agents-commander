import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/defaults.js';
import {
  CONFERENCE_PRESET,
  resolveLaunchOptions,
  type ExplicitLaunchOptions,
} from '../../src/config/launch-options.js';

function savedConfig() {
  return {
    ...defaultConfig,
    theme: 'saved-theme',
    panelCount: 4 as const,
    showHidden: true,
    editor: { ...defaultConfig.editor },
    agents: Object.fromEntries(
      Object.entries(defaultConfig.agents).map(([type, agent]) => [
        type,
        {
          ...agent,
          args: [...agent.args],
          env: { ...agent.env },
        },
      ]),
    ),
    orchestration: { ...defaultConfig.orchestration },
    hardware: {
      codexMicro: { ...defaultConfig.hardware.codexMicro },
    },
  };
}

describe('resolveLaunchOptions', () => {
  it.each<{
    label: string;
    explicit: ExplicitLaunchOptions;
    expected: {
      theme: string;
      panels: number;
      density: 'auto' | 2 | 3 | 4;
      showHidden: boolean;
      skipWelcome: boolean;
      conference: boolean;
      demo: boolean;
    };
  }>([
    {
      label: 'saved configuration only',
      explicit: {},
      expected: {
        theme: 'saved-theme',
        panels: 4,
        density: 'auto',
        showHidden: true,
        skipWelcome: false,
        conference: false,
        demo: false,
      },
    },
    {
      label: 'conference preset over saved configuration',
      explicit: { conference: true },
      expected: {
        theme: 'midnight',
        panels: 2,
        density: 2,
        showHidden: false,
        skipWelcome: true,
        conference: true,
        demo: false,
      },
    },
    {
      label: 'explicit fields over conference preset',
      explicit: {
        conference: true,
        theme: 'presenter-theme',
        panels: 75,
        density: 3,
        showHidden: true,
        skipWelcome: false,
      },
      expected: {
        theme: 'presenter-theme',
        panels: 75,
        density: 3,
        showHidden: true,
        skipWelcome: false,
        conference: true,
        demo: false,
      },
    },
    {
      label: 'demo implies conference preset',
      explicit: { demo: true },
      expected: {
        theme: 'midnight',
        panels: 2,
        density: 2,
        showHidden: false,
        skipWelcome: true,
        conference: true,
        demo: true,
      },
    },
    {
      label: 'explicit fields still win in demo mode',
      explicit: {
        demo: true,
        conference: false,
        theme: 'classic-blue',
        panels: 100,
        density: 4,
        showHidden: true,
        skipWelcome: false,
      },
      expected: {
        theme: 'classic-blue',
        panels: 100,
        density: 4,
        showHidden: true,
        skipWelcome: false,
        conference: true,
        demo: true,
      },
    },
  ])('$label', ({ explicit, expected }) => {
    const result = resolveLaunchOptions(savedConfig(), explicit);

    expect(result).toMatchObject({
      skipWelcome: expected.skipWelcome,
      conference: expected.conference,
      demo: expected.demo,
    });
    expect(result.config).toMatchObject({
      theme: expected.theme,
      panelCount: expected.panels,
      panelDensity: expected.density,
      showHidden: expected.showHidden,
    });
  });

  it('returns a deep launch clone and never mutates saved configuration', () => {
    const saved = savedConfig();
    const snapshot = structuredClone(saved);

    const result = resolveLaunchOptions(saved, { demo: true });
    result.config.editor.tabSize = 12;
    result.config.agents.codex.args.push('--demo-only');
    result.config.agents.codex.env.DEMO_ONLY = '1';
    if (result.config.orchestration) {
      result.config.orchestration.ackTimeout = 1;
    }
    result.config.hardware.codexMicro.enabled = true;

    expect(saved).toEqual(snapshot);
    expect(result.config).not.toBe(saved);
    expect(result.config.editor).not.toBe(saved.editor);
    expect(result.config.agents.codex).not.toBe(saved.agents.codex);
    expect(result.config.agents.codex.args).not.toBe(saved.agents.codex.args);
    expect(result.config.agents.codex.env).not.toBe(saved.agents.codex.env);
    expect(result.config.orchestration).not.toBe(saved.orchestration);
    expect(result.config.hardware).not.toBe(saved.hardware);
    expect(result.config.hardware.codexMicro).not.toBe(saved.hardware.codexMicro);
  });

  it('supplies default profiles for pre-profile runtime configuration objects', () => {
    const legacy = savedConfig() as Record<string, unknown>;
    delete legacy.agentProfiles;

    const result = resolveLaunchOptions(legacy as never);

    expect(result.config.agentProfiles.map((profile) => profile.id)).toEqual(
      defaultConfig.agentProfiles.map((profile) => profile.id),
    );
  });

  it('migrates density for pre-density runtime configuration objects', () => {
    const legacy = savedConfig() as Record<string, unknown>;
    legacy.panelCount = 3;
    delete legacy.panelDensity;

    const result = resolveLaunchOptions(legacy as never);

    expect(result.config.panelCount).toBe(3);
    expect(result.config.panelDensity).toBe(3);
    expect(legacy).not.toHaveProperty('panelDensity');
  });

  it('supplies disabled defaults for pre-hardware runtime configuration objects', () => {
    const legacy = savedConfig() as Record<string, unknown>;
    delete legacy.hardware;

    const result = resolveLaunchOptions(legacy as never);

    expect(result.config.hardware).toEqual(defaultConfig.hardware);
    expect(result.config.hardware).not.toBe(defaultConfig.hardware);
    expect(result.config.hardware.codexMicro).not.toBe(defaultConfig.hardware.codexMicro);
  });

  it('applies explicit Codex Micro enable and disable overrides for one launch', () => {
    const disabled = resolveLaunchOptions(savedConfig(), { codexMicro: true });
    expect(disabled.config.hardware.codexMicro.enabled).toBe(true);

    const savedEnabled = savedConfig();
    savedEnabled.hardware.codexMicro.enabled = true;
    const enabled = resolveLaunchOptions(savedEnabled, { codexMicro: false });
    expect(enabled.config.hardware.codexMicro.enabled).toBe(false);
    expect(savedEnabled.hardware.codexMicro.enabled).toBe(true);
  });

  it('makes Codex Micro test mode opt-in, enabled, and welcome-free without starting demo', () => {
    const regular = resolveLaunchOptions(savedConfig());
    expect(regular).toMatchObject({
      codexMicroTest: false,
      skipWelcome: false,
      conference: false,
      demo: false,
    });
    expect(regular.config.hardware.codexMicro.enabled).toBe(false);

    const testMode = resolveLaunchOptions(savedConfig(), {
      codexMicro: false,
      codexMicroTest: true,
      skipWelcome: false,
    });
    expect(testMode).toMatchObject({
      codexMicroTest: true,
      skipWelcome: true,
      conference: false,
      demo: false,
    });
    expect(testMode.config.hardware.codexMicro.enabled).toBe(true);
  });

  it('ignores out-of-range runtime panel values without mutating saved settings', () => {
    const result = resolveLaunchOptions(savedConfig(), {
      panels: 101,
      density: 5 as never,
    });

    expect(result.config.panelCount).toBe(4);
    expect(result.config.panelDensity).toBe('auto');
  });

  it('exposes an immutable conference preset with presentation-safe defaults', () => {
    expect(CONFERENCE_PRESET).toEqual({
      theme: 'midnight',
      panels: 2,
      density: 2,
      showHidden: false,
      skipWelcome: true,
    });
    expect(Object.isFrozen(CONFERENCE_PRESET)).toBe(true);
  });
});
