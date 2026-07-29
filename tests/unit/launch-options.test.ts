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
  };
}

describe('resolveLaunchOptions', () => {
  it.each<{
    label: string;
    explicit: ExplicitLaunchOptions;
    expected: {
      theme: string;
      panels: 2 | 3 | 4;
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
        panels: 3,
        showHidden: true,
        skipWelcome: false,
      },
      expected: {
        theme: 'presenter-theme',
        panels: 3,
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
        panels: 4,
        showHidden: true,
        skipWelcome: false,
      },
      expected: {
        theme: 'classic-blue',
        panels: 4,
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

    expect(saved).toEqual(snapshot);
    expect(result.config).not.toBe(saved);
    expect(result.config.editor).not.toBe(saved.editor);
    expect(result.config.agents.codex).not.toBe(saved.agents.codex);
    expect(result.config.agents.codex.args).not.toBe(saved.agents.codex.args);
    expect(result.config.agents.codex.env).not.toBe(saved.agents.codex.env);
    expect(result.config.orchestration).not.toBe(saved.orchestration);
  });

  it('exposes an immutable conference preset with presentation-safe defaults', () => {
    expect(CONFERENCE_PRESET).toEqual({
      theme: 'midnight',
      panels: 2,
      showHidden: false,
      skipWelcome: true,
    });
    expect(Object.isFrozen(CONFERENCE_PRESET)).toBe(true);
  });
});
