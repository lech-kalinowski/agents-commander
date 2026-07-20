import type { AppConfig } from './types.js';

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
  agents: {
    claude: { command: 'claude', args: ['--dangerously-skip-permissions'], env: {} },
    codex: { command: 'codex', args: ['--full-auto', '--no-alt-screen'], env: {} },
    gemini: { command: 'gemini', args: ['--yolo'], env: {} },
    aider: { command: 'aider', args: [], env: {} },
    cline: { command: 'cline', args: [], env: {} },
    goose: { command: 'goose', args: [], env: {} },
    opencode: { command: 'opencode', args: [], env: {} },
    kiro: { command: 'kiro', args: [], env: {} },
    amp: { command: 'amp', args: [], env: {} },
    generic: { command: 'bash', args: [], env: {} },
  },
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
