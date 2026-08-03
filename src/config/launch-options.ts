import type { AppConfig } from './types.js';
import { defaultConfig } from './defaults.js';

export type LaunchPanelCount = 2 | 3 | 4;

/**
 * Launch-only values supplied by the CLI or another embedding application.
 * Undefined fields do not override either the saved configuration or the
 * conference preset.
 */
export interface ExplicitLaunchOptions {
  theme?: string;
  panels?: LaunchPanelCount;
  showHidden?: boolean;
  skipWelcome?: boolean;
  conference?: boolean;
  demo?: boolean;
}

export interface ResolvedLaunchOptions {
  config: AppConfig;
  skipWelcome: boolean;
  conference: boolean;
  demo: boolean;
}

export const CONFERENCE_PRESET = Object.freeze({
  theme: 'midnight',
  panels: 2 as const,
  showHidden: false,
  skipWelcome: true,
});

function cloneConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    editor: { ...config.editor },
    agents: Object.fromEntries(
      Object.entries(config.agents).map(([type, agent]) => [
        type,
        {
          ...agent,
          args: [...agent.args],
          env: { ...agent.env },
        },
      ]),
    ),
    agentProfiles: (config.agentProfiles ?? defaultConfig.agentProfiles).map((profile) => ({
      ...profile,
      args: profile.args ? [...profile.args] : undefined,
      env: profile.env ? { ...profile.env } : undefined,
    })),
    orchestration: config.orchestration === undefined
      ? undefined
      : { ...config.orchestration },
  };
}

/**
 * Resolve launch behavior without reading or writing persisted configuration.
 *
 * Precedence is:
 *   saved config -> conference preset -> explicit launch fields
 *
 * Demo mode always enables the conference preset. Explicit visual fields
 * still win, so a presenter can selectively customize the preset.
 */
export function resolveLaunchOptions(
  savedConfig: AppConfig,
  explicit: ExplicitLaunchOptions = {},
): ResolvedLaunchOptions {
  const config = cloneConfig(savedConfig);
  const demo = explicit.demo === true;
  const conference = demo || explicit.conference === true;
  let skipWelcome = false;

  if (conference) {
    config.theme = CONFERENCE_PRESET.theme;
    config.panelCount = CONFERENCE_PRESET.panels;
    config.showHidden = CONFERENCE_PRESET.showHidden;
    skipWelcome = CONFERENCE_PRESET.skipWelcome;
  }

  if (explicit.theme !== undefined) config.theme = explicit.theme;
  if (explicit.panels !== undefined) config.panelCount = explicit.panels;
  if (explicit.showHidden !== undefined) config.showHidden = explicit.showHidden;
  if (explicit.skipWelcome !== undefined) skipWelcome = explicit.skipWelcome;

  return {
    config,
    skipWelcome,
    conference,
    demo,
  };
}
