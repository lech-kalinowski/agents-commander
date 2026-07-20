import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentCommandConfig, AppConfig, OrchestrationConfig } from './types.js';
import { defaultConfig } from './defaults.js';

const CONFIG_DIR = path.join(os.homedir(), '.agents-commander');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PANEL_COUNTS = new Set([2, 3, 4]);
const SORT_FIELDS = new Set(['name', 'size', 'date', 'ext']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asFiniteNumber(value: unknown, fallback: number, options: { min: number; max: number; integer?: boolean }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = options.integer ? Math.trunc(value) : value;
  return normalized >= options.min && normalized <= options.max ? normalized : fallback;
}

function normalizeEnv(value: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!isPlainObject(value)) return { ...fallback };
  const env: Record<string, string> = { ...fallback };
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') env[key] = entry;
  }
  return env;
}

function normalizeAgent(value: unknown, fallback: AgentCommandConfig): AgentCommandConfig {
  const input = isPlainObject(value) ? value : {};
  return {
    command: typeof input.command === 'string' && input.command.trim() ? input.command : fallback.command,
    args: Array.isArray(input.args) && input.args.every((entry) => typeof entry === 'string')
      ? [...input.args]
      : [...fallback.args],
    env: normalizeEnv(input.env, fallback.env),
  };
}

function normalizeOrchestration(value: unknown): OrchestrationConfig {
  const input = isPlainObject(value) ? value : {};
  const defaults = defaultConfig.orchestration as OrchestrationConfig;
  return {
    gridScanDelay: asFiniteNumber(input.gridScanDelay, defaults.gridScanDelay, { min: 10, max: 60000 }),
    injectionGrace: asFiniteNumber(input.injectionGrace, defaults.injectionGrace, { min: 0, max: 300000 }),
    initDelay: asFiniteNumber(input.initDelay, defaults.initDelay, { min: 0, max: 300000 }),
    claudeSubmitDelay: asFiniteNumber(input.claudeSubmitDelay, defaults.claudeSubmitDelay, { min: 0, max: 300000 }),
    ackTimeout: asFiniteNumber(input.ackTimeout, defaults.ackTimeout, { min: 100, max: 3600000 }),
    dedupWindow: asFiniteNumber(input.dedupWindow, defaults.dedupWindow, { min: 0, max: 3600000 }),
    maxContentLines: asFiniteNumber(input.maxContentLines, defaults.maxContentLines, { min: 1, max: 100000, integer: true }),
  };
}

function normalizeConfig(value: unknown): AppConfig {
  const input = isPlainObject(value) ? value : {};
  const editor = isPlainObject(input.editor) ? input.editor : {};
  const rawAgents = isPlainObject(input.agents) ? input.agents : {};
  const agents: Record<string, AgentCommandConfig> = {};

  for (const [agentType, defaults] of Object.entries(defaultConfig.agents)) {
    agents[agentType] = normalizeAgent(rawAgents[agentType], defaults);
  }

  return {
    theme: typeof input.theme === 'string' && input.theme.trim() ? input.theme : defaultConfig.theme,
    panelCount: typeof input.panelCount === 'number' && PANEL_COUNTS.has(input.panelCount)
      ? input.panelCount as 2 | 3 | 4
      : defaultConfig.panelCount,
    showHidden: typeof input.showHidden === 'boolean' ? input.showHidden : defaultConfig.showHidden,
    sortBy: typeof input.sortBy === 'string' && SORT_FIELDS.has(input.sortBy)
      ? input.sortBy as AppConfig['sortBy']
      : defaultConfig.sortBy,
    sortAscending: typeof input.sortAscending === 'boolean' ? input.sortAscending : defaultConfig.sortAscending,
    watchDebounce: asFiniteNumber(input.watchDebounce, defaultConfig.watchDebounce, { min: 10, max: 60000 }),
    editor: {
      tabSize: asFiniteNumber(editor.tabSize, defaultConfig.editor.tabSize, { min: 1, max: 16, integer: true }),
      wordWrap: typeof editor.wordWrap === 'boolean' ? editor.wordWrap : defaultConfig.editor.wordWrap,
    },
    agents,
    orchestration: normalizeOrchestration(input.orchestration),
  };
}

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
    }
  } catch {
    // Fall through to a fresh copy of the defaults.
  }
  return normalizeConfig({});
}

export function saveConfig(config: AppConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalizeConfig(config), null, 2), 'utf-8');
}
