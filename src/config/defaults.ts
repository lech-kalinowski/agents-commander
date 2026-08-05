import type { NormalizedAppConfig } from './types.js';
import { DEFAULT_AGENT_PROFILES, KNOWN_AGENTS } from '../agents/types.js';

const defaultAgents = Object.fromEntries(
  KNOWN_AGENTS.map((agent) => [
    agent.type,
    {
      command: agent.command,
      args: [...agent.args],
      env: { ...agent.env },
    },
  ]),
);

export const defaultConfig: NormalizedAppConfig = {
  theme: 'classic-blue',
  panelCount: 2,
  panelDensity: 'auto',
  showHidden: false,
  sortBy: 'name',
  sortAscending: true,
  watchDebounce: 100,
  editor: {
    tabSize: 2,
    wordWrap: true,
  },
  agents: defaultAgents,
  agentProfiles: DEFAULT_AGENT_PROFILES.map((profile) => ({
    ...profile,
    args: profile.args ? [...profile.args] : undefined,
    env: profile.env ? { ...profile.env } : undefined,
  })),
  orchestration: {
    gridScanDelay: 200,
    injectionGrace: 2500,
    initDelay: 3000,
    claudeSubmitDelay: 2500,
    ackTimeout: 60000,
    dedupWindow: 15000,
    maxContentLines: 500,
    maxContentBytes: 262144,
  },
  hardware: {
    codexMicro: {
      enabled: false,
      decisionControls: true,
    },
  },
};
