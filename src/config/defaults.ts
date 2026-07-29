import type { AppConfig } from './types.js';
import { KNOWN_AGENTS } from '../agents/types.js';

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

export const defaultConfig: AppConfig = {
  theme: 'classic-blue',
  panelCount: 2,
  showHidden: false,
  sortBy: 'name',
  sortAscending: true,
  watchDebounce: 100,
  editor: {
    tabSize: 2,
    wordWrap: true,
  },
  agents: defaultAgents,
  orchestration: {
    gridScanDelay: 200,
    injectionGrace: 2500,
    initDelay: 3000,
    claudeSubmitDelay: 2500,
    ackTimeout: 60000,
    dedupWindow: 15000,
    maxContentLines: 500,
  },
};
