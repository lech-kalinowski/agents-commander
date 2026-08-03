export { App } from './app.js';
export type { AppLaunchOptions } from './app.js';
export { getTheme, themes } from './config/themes.js';
export { loadConfig, saveConfig } from './config/loader.js';
export {
  CONFERENCE_PRESET,
  resolveLaunchOptions,
} from './config/launch-options.js';
export {
  discoverAgents,
  getAgentProfileInfo,
  getInstalledAgents,
} from './agents/agent-registry.js';
export { AgentManager } from './agents/agent-manager.js';
export {
  createDemoAgentLaunchSpec,
  DEMO_AGENT_ROLES,
  DEMO_AGENT_ROLE_ORDER,
} from './demo/demo-agents.js';
export {
  createDemoWorkspace,
  DEMO_WORKSPACE_FILES,
} from './demo/demo-workspace.js';
export { Orchestrator } from './orchestration/orchestrator.js';
export { ProtocolScanner, buildProtocolInstructions } from './orchestration/protocol.js';
export {
  MAX_ACTIVE_PANELS,
  MAX_PANEL_ID,
  MAX_PANEL_NUMBER,
  MIN_ACTIVE_PANELS,
  MIN_PANEL_ID,
  MIN_PANEL_NUMBER,
  isActivePanelCount,
  isPanelDensity,
  isPanelId,
  isPanelNumber,
  parseActivePanelCount,
  parsePanelDensity,
} from './panel-limits.js';
export { TerminalPanel } from './panels/terminal-panel.js';
export { VTerm } from './panels/vterm.js';
export { loadTemplates } from './templates/loader.js';
export type {
  AgentInfo,
  AgentProfile,
  AgentStatus,
  AgentType,
  OpenCodeAgentProfile,
} from './agents/types.js';
export type { InternalAgentLaunchSpec } from './agents/agent-manager.js';
export type {
  ExplicitLaunchOptions,
  LaunchPanelCount,
  ResolvedLaunchOptions,
} from './config/launch-options.js';
export type { AppConfig, Theme } from './config/types.js';
export type { PanelDensity } from './panel-limits.js';
export type { DemoAgentRole } from './demo/demo-agents.js';
export type { DemoWorkspace } from './demo/demo-workspace.js';
export type { PromptTemplate } from './templates/types.js';
