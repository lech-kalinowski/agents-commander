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

export interface AgentInfo {
  type: AgentType;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description: string;
  installCommand: string;
  installed: boolean;
  supported: boolean; // Phase 1 supported agents
  /** CLI flag to set the project root directory (e.g. '--directory' for Claude). */
  projectDirFlag?: string;
}

export interface AgentSession {
  id: string;
  type: AgentType;
  status: AgentStatus;
  panelIndex: number;
  pid?: number;
  startedAt: Date;
}

export const KNOWN_AGENTS: Omit<AgentInfo, 'installed'>[] = [
  {
    type: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: ['--dangerously-skip-permissions'],
    env: {},
    description: 'Anthropic - AI coding agent with MCP support',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    supported: true,
  },
  {
    type: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: ['--full-auto', '--no-alt-screen'],
    env: {},
    description: 'OpenAI - AI coding agent',
    installCommand: 'npm install -g @openai/codex',
    supported: true,
  },
  {
    type: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: ['--yolo'],
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
    description: 'Open source AI coding agent (Go)',
    installCommand: 'brew install opencode',
    supported: false,
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
];
