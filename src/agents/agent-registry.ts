import type { AgentInfo, AgentType } from './types.js';
import { KNOWN_AGENTS } from './types.js';
import { logger } from '../utils/logger.js';
import { resolveExecutablePath } from '../utils/command-resolution.js';
import type { AgentCommandConfig } from '../config/types.js';

let cachedAgents: AgentInfo[] | null = null;

function resolveCommand(command: string): string | null {
  return resolveExecutablePath(command);
}

function discover(overrides?: Record<string, AgentCommandConfig>): AgentInfo[] {
  return KNOWN_AGENTS.map((agent) => {
    const override = overrides?.[agent.type];
    const command = override?.command ?? agent.command;
    const fullPath = resolveCommand(command);
    const installed = fullPath !== null;
    if (installed) {
      logger.info(`Agent found: ${agent.name} -> ${fullPath}`);
    }
    return {
      ...agent,
      command: fullPath ?? command,
      args: override ? [...override.args] : [...agent.args],
      env: override ? { ...override.env } : { ...agent.env },
      installed,
    };
  });
}

export function discoverAgents(overrides?: Record<string, AgentCommandConfig>): AgentInfo[] {
  if (overrides) return discover(overrides);
  if (cachedAgents) return cachedAgents;

  cachedAgents = discover();

  return cachedAgents;
}

/** Force re-scan (e.g. after user installs an agent). */
export function refreshAgentDiscovery(): void {
  cachedAgents = null;
}

export function getInstalledAgents(): AgentInfo[] {
  return discoverAgents().filter((a) => a.installed);
}

export function getSupportedAgents(): AgentInfo[] {
  return discoverAgents().filter((a) => a.supported);
}

export function getAgentInfo(
  type: AgentType,
  overrides?: Record<string, AgentCommandConfig>,
): AgentInfo | undefined {
  return discoverAgents(overrides).find((a) => a.type === type);
}
