import type { AgentInfo, AgentProfile, AgentType } from './types.js';
import { DEFAULT_AGENT_PROFILES, KNOWN_AGENTS } from './types.js';
import { buildOpenCodeLaunchConfig } from './opencode-adapter.js';
import { logger } from '../utils/logger.js';
import { resolveExecutablePath } from '../utils/command-resolution.js';
import type { AgentCommandConfig } from '../config/types.js';

let cachedAgents: AgentInfo[] | null = null;

type ExecutableResolver = (command: string) => string | null;

function cloneDefaultProfiles(): AgentProfile[] {
  return DEFAULT_AGENT_PROFILES.map((profile) => ({
    ...profile,
    args: profile.args ? [...profile.args] : undefined,
    env: profile.env ? { ...profile.env } : undefined,
  }));
}

function discover(
  overrides: Record<string, AgentCommandConfig> | undefined,
  profiles: readonly AgentProfile[] | undefined,
  resolveExecutable: ExecutableResolver,
): AgentInfo[] {
  const sourceProfiles = profiles ?? cloneDefaultProfiles();
  const seen = new Set<string>();
  const result: AgentInfo[] = [];

  for (const profile of sourceProfiles) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    const agent = KNOWN_AGENTS.find((candidate) => candidate.type === profile.adapter);
    if (!agent) continue;

    const override = overrides?.[profile.adapter];
    const command = profile.command ?? override?.command ?? agent.command;
    let args = profile.args
      ? [...profile.args]
      : override ? [...override.args] : [...agent.args];
    let env = {
      ...(override ? override.env : agent.env),
      ...(profile.env ?? {}),
    };
    const configurationErrors = profile.configurationError
      ? [profile.configurationError]
      : [];

    if (profile.adapter === 'opencode') {
      const launchConfig = buildOpenCodeLaunchConfig(profile, args, env);
      args = launchConfig.args;
      env = launchConfig.env;
      if (launchConfig.configurationError) {
        configurationErrors.push(launchConfig.configurationError);
      }
    }

    const fullPath = resolveExecutable(command);
    const installed = fullPath !== null;
    if (installed) {
      logger.info(`Agent profile found: ${profile.label} -> ${fullPath}`);
    }
    result.push({
      ...agent,
      profileId: profile.id,
      profileLabel: profile.label,
      name: profile.label,
      command: fullPath ?? command,
      args,
      env,
      installed,
      ...(profile.adapter === 'opencode' && profile.model ? { model: profile.model } : {}),
      ...(configurationErrors.length > 0
        ? { configurationError: configurationErrors.join('; ') }
        : {}),
    });
  }

  return result;
}

export function discoverAgents(
  overrides?: Record<string, AgentCommandConfig>,
  profiles?: readonly AgentProfile[],
): AgentInfo[] {
  if (overrides || profiles) return discover(overrides, profiles, resolveExecutablePath);
  if (cachedAgents) return cachedAgents;

  cachedAgents = discover(undefined, undefined, resolveExecutablePath);
  return cachedAgents;
}

/** Deterministic discovery hook used by Doctor without launching agent CLIs. */
export function discoverAgentsWithResolver(
  overrides: Record<string, AgentCommandConfig>,
  profiles: readonly AgentProfile[],
  resolveExecutable: ExecutableResolver,
): AgentInfo[] {
  return discover(overrides, profiles, resolveExecutable);
}

/** Force re-scan (e.g. after user installs an agent). */
export function refreshAgentDiscovery(): void {
  cachedAgents = null;
}

export function getInstalledAgents(): AgentInfo[] {
  return discoverAgents().filter((agent) => agent.installed);
}

export function getSupportedAgents(): AgentInfo[] {
  return discoverAgents().filter((agent) => agent.supported);
}

export function getAgentInfo(
  type: AgentType,
  overrides?: Record<string, AgentCommandConfig>,
  profiles?: readonly AgentProfile[],
): AgentInfo | undefined {
  const agents = discoverAgents(overrides, profiles);
  return agents.find((agent) => agent.profileId === type && agent.type === type);
}

export function getAgentProfileInfo(
  profileId: string,
  overrides?: Record<string, AgentCommandConfig>,
  profiles?: readonly AgentProfile[],
): AgentInfo | undefined {
  return discoverAgents(overrides, profiles).find((agent) => agent.profileId === profileId);
}
