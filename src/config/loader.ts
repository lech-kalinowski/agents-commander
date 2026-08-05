import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentCommandConfig, AppConfig, OrchestrationConfig } from './types.js';
import { defaultConfig } from './defaults.js';
import type { AgentProfile, AgentType } from '../agents/types.js';
import { KNOWN_AGENTS } from '../agents/types.js';
import { isActivePanelCount, isPanelDensity } from '../panel-limits.js';

const CONFIG_DIR = path.join(os.homedir(), '.agents-commander');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SORT_FIELDS = new Set(['name', 'size', 'date', 'ext']);
const AGENT_TYPES = new Set<AgentType>(KNOWN_AGENTS.map((agent) => agent.type));
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ENVIRONMENT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]/u;

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
    if (
      ENVIRONMENT_KEY_RE.test(key) &&
      typeof entry === 'string' &&
      !entry.includes('\0')
    ) env[key] = entry;
  }
  return env;
}

function normalizeAgent(value: unknown, fallback: AgentCommandConfig): AgentCommandConfig {
  const input = isPlainObject(value) ? value : {};
  return {
    command: typeof input.command === 'string' && input.command.trim() && !input.command.includes('\0')
      ? input.command.trim()
      : fallback.command,
    args: Array.isArray(input.args) && input.args.every(
      (entry) => typeof entry === 'string' && !entry.includes('\0'),
    )
      ? [...input.args]
      : [...fallback.args],
    env: normalizeEnv(input.env, fallback.env),
  };
}

function optionalProfileString(value: unknown): string | undefined {
  if (typeof value !== 'string' || CONTROL_CHARACTER_RE.test(value)) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizedOptionalField(
  input: Record<string, unknown>,
  key: string,
  errors: string[],
): string | undefined {
  if (!hasOwn(input, key) || input[key] === undefined) return undefined;
  const normalized = optionalProfileString(input[key]);
  if (!normalized) errors.push(`${key} must be a non-empty string without control characters`);
  return normalized;
}

function normalizeProfile(value: unknown): AgentProfile | null {
  if (!isPlainObject(value)) return null;
  const id = optionalProfileString(value.id);
  if (!id || !PROFILE_ID_RE.test(id)) return null;

  const defaultProfile = defaultConfig.agentProfiles.find((profile) => profile.id === id);
  const errors: string[] = [];
  const normalizedLabel = optionalProfileString(value.label);
  const label = normalizedLabel && normalizedLabel.length <= 120
    ? normalizedLabel
    : defaultProfile?.label ?? id;
  if (!normalizedLabel || normalizedLabel.length > 120) {
    errors.push('label must be a non-empty string of at most 120 characters without controls');
  }

  const adapter = typeof value.adapter === 'string' && AGENT_TYPES.has(value.adapter as AgentType)
    ? value.adapter as AgentType
    : defaultProfile?.adapter ?? 'generic';
  if (typeof value.adapter !== 'string' || !AGENT_TYPES.has(value.adapter as AgentType)) {
    errors.push('adapter must name a supported agent adapter');
  }

  const command = normalizedOptionalField(value, 'command', errors);
  let args: string[] | undefined;
  if (hasOwn(value, 'args') && value.args !== undefined) {
    if (Array.isArray(value.args) && value.args.every(
      (entry) => typeof entry === 'string' && !entry.includes('\0'),
    )) {
      args = [...value.args];
    } else {
      errors.push('args must be an array of strings without NUL characters');
    }
  }
  let env: Record<string, string> | undefined;
  if (hasOwn(value, 'env') && value.env !== undefined) {
    if (isPlainObject(value.env)) {
      env = normalizeEnv(value.env, {});
      if (Object.keys(env).length !== Object.keys(value.env).length) {
        errors.push('env contains an invalid key or non-string/NUL value');
      }
    } else {
      errors.push('env must be an object containing string values');
    }
  }
  const common = {
    id,
    label,
    adapter,
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(errors.length > 0 ? { configurationError: errors.join('; ') } : {}),
  };

  if (adapter === 'opencode') {
    const model = normalizedOptionalField(value, 'model', errors);
    const agent = normalizedOptionalField(value, 'agent', errors);
    const configPath = normalizedOptionalField(value, 'configPath', errors);
    if (configPath && !path.isAbsolute(configPath)) {
      errors.push('configPath must be an absolute path');
    }
    return {
      ...common,
      adapter: 'opencode',
      ...(model ? { model } : {}),
      ...(agent ? { agent } : {}),
      ...(configPath ? { configPath } : {}),
      ...(errors.length > 0 ? { configurationError: errors.join('; ') } : {}),
    };
  }

  for (const openCodeOnlyField of ['model', 'agent', 'configPath']) {
    if (hasOwn(value, openCodeOnlyField) && value[openCodeOnlyField] !== undefined) {
      errors.push(`${openCodeOnlyField} is only valid for OpenCode profiles`);
    }
  }

  return {
    ...common,
    ...(errors.length > 0 ? { configurationError: errors.join('; ') } : {}),
  } as AgentProfile;
}

function normalizeProfiles(value: unknown): AgentProfile[] {
  const profiles = new Map<string, AgentProfile>();
  for (const entry of defaultConfig.agentProfiles) {
    const profile = normalizeProfile(entry);
    if (profile) profiles.set(profile.id, profile);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const profile = normalizeProfile(entry);
      if (profile) profiles.set(profile.id, profile);
    }
  }
  return [...profiles.values()];
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
    maxContentBytes: asFiniteNumber(input.maxContentBytes, defaults.maxContentBytes, { min: 1024, max: 1048576, integer: true }),
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

  const panelCount = isActivePanelCount(input.panelCount)
    ? input.panelCount
    : defaultConfig.panelCount;
  // Before panelDensity existed, panelCount also selected the 2/3/4 layout.
  // Preserve that view for migrated configs while fresh configs use auto.
  const legacyPanelDensity = input.panelCount === 2 || input.panelCount === 3 || input.panelCount === 4
    ? input.panelCount
    : defaultConfig.panelDensity;

  return {
    theme: typeof input.theme === 'string' && input.theme.trim() ? input.theme : defaultConfig.theme,
    panelCount,
    panelDensity: isPanelDensity(input.panelDensity)
      ? input.panelDensity
      : legacyPanelDensity,
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
    agentProfiles: normalizeProfiles(input.agentProfiles),
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
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // The directory may live on a filesystem that does not expose POSIX modes.
  }
  const temporaryFile = path.join(
    CONFIG_DIR,
    `.config.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(normalizeConfig(config), null, 2),
      { encoding: 'utf-8', mode: 0o600, flag: 'wx' },
    );
    fs.renameSync(temporaryFile, CONFIG_FILE);
    try {
      fs.chmodSync(CONFIG_FILE, 0o600);
    } catch {
      // Best effort on non-POSIX filesystems; creation still requested 0600.
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFile);
    } catch {
      // Ignore cleanup failures and preserve the original save error.
    }
    throw error;
  }
}
