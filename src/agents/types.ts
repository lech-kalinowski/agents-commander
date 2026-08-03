export type AgentType =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'aider'
  | 'cline'
  | 'opencode'
  | 'goose'
  | 'kiro'
  | 'amp'
  | 'generic';

export type AgentStatus = 'idle' | 'starting' | 'running' | 'error' | 'exited';

interface AgentProfileBase {
  /** Stable configuration identity, distinct from the adapter/protocol type. */
  id: string;
  /** User-facing name shown in selectors and session status. */
  label: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Normalization error retained so an explicit malformed profile cannot silently fall back. */
  configurationError?: string;
}

export interface OpenCodeAgentProfile extends AgentProfileBase {
  adapter: 'opencode';
  /** Full OpenCode model selector in provider/model form. */
  model?: string;
  /** Optional OpenCode agent name passed with --agent. */
  agent?: string;
  /** Optional OpenCode configuration path mapped to OPENCODE_CONFIG. */
  configPath?: string;
}

export interface StandardAgentProfile extends AgentProfileBase {
  adapter: Exclude<AgentType, 'opencode'>;
  model?: never;
  agent?: never;
  configPath?: never;
}

export type AgentProfile = OpenCodeAgentProfile | StandardAgentProfile;

export interface AgentInfo {
  type: AgentType;
  profileId: string;
  profileLabel: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description: string;
  installCommand: string;
  installed: boolean;
  supported: boolean; // Phase 1 supported agents
  model?: string;
  configurationError?: string;
  /** CLI flag to set the project root directory (e.g. '--directory' for Claude). */
  projectDirFlag?: string;
}

export interface AgentSession {
  id: string;
  type: AgentType;
  profileId: string;
  status: AgentStatus;
  panelIndex: number;
  pid?: number;
  startedAt: Date;
}

export const KNOWN_AGENTS: Omit<AgentInfo, 'installed' | 'profileId' | 'profileLabel'>[] = [
  {
    type: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    env: {},
    description: 'Anthropic - AI coding agent with MCP support',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    supported: true,
  },
  {
    type: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: ['--no-alt-screen'],
    env: {},
    description: 'OpenAI - AI coding agent',
    installCommand: 'npm install -g @openai/codex',
    supported: true,
  },
  {
    type: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    env: {},
    description: 'Google - AI coding agent',
    installCommand: 'npm install -g @google/gemini-cli',
    supported: true,
  },
  {
    type: 'aider',
    name: 'Aider',
    command: 'aider',
    args: [],
    env: {},
    description: 'AI pair programming in terminal (Python)',
    installCommand: 'pip install aider-chat',
    supported: false,
  },
  {
    type: 'cline',
    name: 'Cline CLI 2.0',
    command: 'cline',
    args: [],
    env: {},
    description: 'Terminal AI agent control plane',
    installCommand: 'npm install -g cline',
    supported: false,
  },
  {
    type: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    env: {},
    description: 'Open source multi-provider AI coding agent',
    installCommand: 'npm install -g opencode-ai',
    supported: true,
  },
  {
    type: 'goose',
    name: 'Goose',
    command: 'goose',
    args: [],
    env: {},
    description: 'Block/Square - Multi-LLM agent (Rust)',
    installCommand: 'curl -fsSL https://github.com/block/goose/raw/main/download.sh | bash',
    supported: false,
  },
  {
    type: 'kiro',
    name: 'Kiro CLI',
    command: 'kiro',
    args: [],
    env: {},
    description: 'AWS - AI development agent',
    installCommand: 'npm install -g @anthropic-ai/kiro',
    supported: false,
  },
  {
    type: 'amp',
    name: 'Amp CLI',
    command: 'amp',
    args: [],
    env: {},
    description: 'Sourcegraph AI coding agent',
    installCommand: 'npm install -g @sourcegraph/amp',
    supported: false,
  },
  {
    type: 'generic',
    name: 'Shell',
    command: 'bash',
    args: [],
    env: {},
    description: 'Generic interactive shell',
    installCommand: 'Install bash or configure agents.generic.command',
    supported: true,
  },
];

export const DEFAULT_AGENT_PROFILES: AgentProfile[] = KNOWN_AGENTS.map((agent) => ({
  id: agent.type,
  label: agent.name,
  adapter: agent.type,
})) as AgentProfile[];
