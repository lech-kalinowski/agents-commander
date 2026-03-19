import type { AgentInfo, AgentType } from './types.js';
import { KNOWN_AGENTS } from './types.js';
import { logger } from '../utils/logger.js';
import { resolveExecutablePath } from '../utils/command-resolution.js';

let cachedAgents: AgentInfo[] | null = null;

function resolveCommand(command: string): string | null {
  return resolveExecutablePath(command);
}

export function discoverAgents(): AgentInfo[] {
  if (cachedAgents) return cachedAgents;

  cachedAgents = KNOWN_AGENTS.map((agent) => {
    const fullPath = resolveCommand(agent.command);
    const installed = fullPath !== null;
    if (installed) {
      logger.info(`Agent found: ${agent.name} -> ${fullPath}`);
    }
    return { ...agent, installed, command: fullPath ?? agent.command };
  });

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

export function getAgentInfo(type: AgentType): AgentInfo | undefined {
  return discoverAgents().find((a) => a.type === type);
}
