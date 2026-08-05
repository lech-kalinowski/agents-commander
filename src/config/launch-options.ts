import type { AppConfig, NormalizedAppConfig } from './types.js';
import { defaultConfig } from './defaults.js';
import {
  isActivePanelCount,
  isPanelDensity,
  type PanelDensity,
} from '../panel-limits.js';

/** Initial active workspace size. Runtime validation constrains this to 1..100. */
export type LaunchPanelCount = number;

/**
 * Launch-only values supplied by the CLI or another embedding application.
 * Undefined fields do not override either the saved configuration or the
 * conference preset.
 */
export interface ExplicitLaunchOptions {
  theme?: string;
  panels?: LaunchPanelCount;
  density?: PanelDensity;
  showHidden?: boolean;
  skipWelcome?: boolean;
  conference?: boolean;
  demo?: boolean;
  /** Enable native Codex Micro input, or disable the integration, for this launch. */
  codexMicro?: boolean;
  /** Use legacy Work Louder-programmed keyboard shortcuts for this launch. */
  codexMicroKeyboard?: boolean;
  /** Override guarded physical approve/reject controls for this launch. */
  codexMicroDecisions?: boolean;
  /** Open the Codex Micro input checklist after startup. */
  codexMicroTest?: boolean;
}

export interface ResolvedLaunchOptions {
  config: NormalizedAppConfig;
  skipWelcome: boolean;
  conference: boolean;
  demo: boolean;
  codexMicroTest: boolean;
}

export const CONFERENCE_PRESET = Object.freeze({
  theme: 'midnight',
  panels: 2 as const,
  density: 2 as const,
  showHidden: false,
  skipWelcome: true,
});

function cloneConfig(config: AppConfig): NormalizedAppConfig {
  const legacyPanelDensity = config.panelCount === 2 || config.panelCount === 3 || config.panelCount === 4
    ? config.panelCount
    : defaultConfig.panelDensity;
  return {
    ...config,
    panelDensity: isPanelDensity(config.panelDensity)
      ? config.panelDensity
      : legacyPanelDensity,
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
    hardware: {
      codexMicro: {
        ...defaultConfig.hardware.codexMicro,
        ...config.hardware?.codexMicro,
      },
    },
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
  const codexMicroTest = explicit.codexMicroTest === true;
  let skipWelcome = false;

  if (conference) {
    config.theme = CONFERENCE_PRESET.theme;
    config.panelCount = CONFERENCE_PRESET.panels;
    config.panelDensity = CONFERENCE_PRESET.density;
    config.showHidden = CONFERENCE_PRESET.showHidden;
    skipWelcome = CONFERENCE_PRESET.skipWelcome;
  }

  if (explicit.theme !== undefined) config.theme = explicit.theme;
  if (isActivePanelCount(explicit.panels)) config.panelCount = explicit.panels;
  if (isPanelDensity(explicit.density)) config.panelDensity = explicit.density;
  if (explicit.showHidden !== undefined) config.showHidden = explicit.showHidden;
  if (explicit.skipWelcome !== undefined) skipWelcome = explicit.skipWelcome;
  if (explicit.codexMicro !== undefined) {
    config.hardware.codexMicro.enabled = explicit.codexMicro;
    if (explicit.codexMicro) config.hardware.codexMicro.inputMode = 'native';
  }
  if (explicit.codexMicroKeyboard === true && explicit.codexMicro !== false) {
    config.hardware.codexMicro.inputMode = 'keyboard';
    config.hardware.codexMicro.enabled = true;
  }
  if (explicit.codexMicroDecisions !== undefined) {
    config.hardware.codexMicro.decisionControls = explicit.codexMicroDecisions;
  }

  // Test mode must be usable on a fresh install without changing persisted
  // settings. It is launch-only and does not imply conference or demo mode.
  if (codexMicroTest) {
    config.hardware.codexMicro.enabled = true;
    if (!explicit.codexMicroKeyboard) config.hardware.codexMicro.inputMode = 'native';
    skipWelcome = true;
  }

  return {
    config,
    skipWelcome,
    conference,
    demo,
    codexMicroTest,
  };
}
