import process from 'node:process';
import type { InternalAgentLaunchSpec } from '../agents/agent-manager.js';
import {
  resolveDemoAgentPath,
  runtimeAssetLookupForModule,
  type RuntimeAssetLookupOptions,
} from '../utils/runtime-assets.js';
import { isProtocolCapability } from '../orchestration/protocol.js';

export type DemoAgentRole = 'coordinator' | 'reviewer';

export const DEMO_AGENT_ROLES = Object.freeze({
  coordinator: Object.freeze({
    role: 'coordinator' as const,
    name: 'Demo Coordinator',
  }),
  reviewer: Object.freeze({
    role: 'reviewer' as const,
    name: 'Demo Reviewer',
  }),
});

export const DEMO_AGENT_ROLE_ORDER: readonly DemoAgentRole[] = Object.freeze([
  'coordinator',
  'reviewer',
]);

/**
 * Build the internal launch description consumed by AgentManager. The Node
 * executable is already absolute, and the standalone script asset is resolved
 * for both source checkouts and installed package layouts.
 */
export function createDemoAgentLaunchSpec(
  role: DemoAgentRole,
  lookupOptions: RuntimeAssetLookupOptions = runtimeAssetLookupForModule(import.meta.url),
  protocolCapability?: string,
): InternalAgentLaunchSpec {
  const scriptPath = resolveDemoAgentPath(lookupOptions);
  if (!scriptPath) {
    throw new Error('Offline demo agent asset was not found in this installation');
  }
  if (protocolCapability !== undefined && !isProtocolCapability(protocolCapability)) {
    throw new Error('Offline demo protocol capability is invalid');
  }

  return {
    name: DEMO_AGENT_ROLES[role].name,
    command: process.execPath,
    args: [
      scriptPath,
      '--role',
      role,
      ...(protocolCapability ? ['--protocol-capability', protocolCapability] : []),
    ],
  };
}
