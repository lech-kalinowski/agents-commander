<p align="center">
  <br>
  <img width="180" src="https://github.com/lech-kalinowski/agents-commander/blob/main/assets/logo.png" alt="Agents Commander">
  <br>
  <br>
</p>

<p align="center">
<pre align="center">
┏━┓┏━╸┏━╸┏┓╻╺┳╸┏━┓
┣━┫┃╺┓┣╸ ┃┗┫ ┃ ┗━┓
╹ ╹┗━┛┗━╸╹ ╹ ╹ ┗━┛
┏━╸┏━┓┏┳┓┏┳┓┏━┓┏┓╻╺┳┓┏━╸┏━┓
┃  ┃ ┃┃┃┃┃┃┃┣━┫┃┗┫ ┃┃┣╸ ┣┳┛
┗━╸┗━┛╹ ╹╹ ╹╹ ╹╹ ╹╺┻┛┗━╸╹┗╸
</pre>
</p>

<p align="center">
  <b>Multi-panel terminal for AI agents that talk to each other.</b><br>
  Run Claude, Codex, and Gemini side by side. Make them talk to each other.
</p>

<p align="center">
  <a href="#install">Install</a> &bull;
  <a href="#demo">Demo</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#inter-agent-communication">Agent-to-Agent</a> &bull;
  <a href="#keyboard-shortcuts">Shortcuts</a> &bull;
  <a href="#configuration">Config</a>
</p>

---

> **What if your AI agents could collaborate?**
>
> You tell Claude to analyze code. Claude finds bugs. Claude _asks Codex to write the tests_. Codex finishes and _sends results back to Claude_. You watch it happen in real-time, in split panels, in your terminal.
>
> That's Agents Commander.

## Quick Start

```bash
npm install -g agents-commander
agents-commander
```

---

## The Problem

You have Claude Code, Codex CLI, Gemini CLI. All powerful. All isolated. You copy-paste between them like it's 2005.

**Agents Commander puts them in one terminal, side by side, and lets them talk to each other.**

## Requirements

- Node.js 18+
- macOS or Linux
- at least one supported AI agent CLI installed

## Demo

```
+---------------------------+---------------------------+
|  Panel 1: Claude Code     |  Panel 2: Codex CLI       |
|  * Analyzing src/app.ts   |  * Writing tests...       |
|                           |                           |
|  Found 3 issues:          |  > Received from Claude:  |
|  1. Race condition in...  |    "Write tests for these |
|  2. Missing null check... |     3 functions..."       |
|  3. Memory leak in...     |                           |
|                           |  Creating test suite...   |
|  ===COMMANDER:SEND:codex  |  test('handles race') {   |
|  :2===                    |    ...                    |
|  Write unit tests for     |  }                        |
|  these 3 issues...        |                           |
|  ===COMMANDER:END===      |  Done. 12 tests passing.  |
|                           |                           |
+---------------------------+---------------------------+
 F1Help F2Agent F3+Panel F4View F5Edit F6Copy F7Move F8Mkdir F9Del F10Quit
```

## Features

### Multi-Agent Terminal

Run up to **4 AI agents simultaneously** in split panels. Each agent gets its own pseudo-terminal with full ANSI/xterm-256color support. Type directly into any agent -- keystrokes are forwarded in real-time.

- **Claude Code** (Anthropic)
- **Codex CLI** (OpenAI)
- **Gemini CLI** (Google)
- More agents coming: Aider, Cline, OpenCode, Goose, Kiro, Amp

### Dual-Panel File Manager

A dual-panel file manager built into the same interface. Browse, copy, move, rename, and delete files without leaving the tool. Toggle between file panels and agent terminals with `Ctrl+T`.

### Inter-Agent Communication

The killer feature. Agents can **autonomously send tasks to each other** using a lightweight protocol. No API glue, no custom integrations -- just output markers that Commander intercepts and routes.

### Built-in Editor

View and edit files with syntax highlighting, directly in the terminal. Open any file with `F4`, or jump into `vim` with `Ctrl+G`.

### Themes

Ships with `classic-blue` and `midnight` (dark mode). Fully customizable via config.

## Inter-Agent Communication

This is what makes Agents Commander different from running `tmux` with multiple agents.

### How it works

1. **Launch agents** in different panels (`F2`)
2. **Inject the protocol** into each agent (`Ctrl+P`) -- this teaches the agent it can talk to other agents
3. **Give a task** that requires collaboration:

```
"Analyze this codebase for security issues, then ask Codex in Panel 2
to fix every vulnerability you find."
```

4. **Watch it happen.** Claude analyzes, finds issues, sends them to Codex. Codex fixes, reports back.

### The Protocol

Five commands, one shared end marker. All text-based -- any agent that can print text can use them.

**SEND** -- direct message to a specific agent:
```
===COMMANDER:SEND:codex:2===
Please write unit tests for the auth module.
===COMMANDER:END===
```

**REPLY** -- respond to whoever last messaged you (no panel number needed):
```
===COMMANDER:REPLY===
Tests written. 12 passing, 0 failing.
===COMMANDER:END===
```

**BROADCAST** -- send to all connected agents at once:
```
===COMMANDER:BROADCAST===
Phase 1 complete. All agents: begin phase 2.
===COMMANDER:END===
```

**STATUS** -- report progress (shown as a toast in Commander UI, not sent to agents):
```
===COMMANDER:STATUS===
Analyzing file 5 of 10...
===COMMANDER:END===
```

**QUERY** -- ask Commander what agents are running:
```
===COMMANDER:QUERY===
agents
===COMMANDER:END===
```

Commander's `ProtocolScanner` watches all agent output in real-time, strips ANSI codes, detects these markers across streaming chunks, and routes the message. The target agent sees:

```
[From Claude Code in Panel 1]: Please write unit tests for the auth module...
```

After delivery, the sender gets an **ACK**:
```
[Commander] Message delivered to codex in Panel 2 (OK)
```

Fully bidirectional. Any agent to any agent.

### Manual Orchestration

Don't want to wait for agents to figure it out? Press `Ctrl+O` to manually send a task to any agent in any panel. Commander handles launching, initialization, and delivery.

### Prompt Template Library

**120 built-in prompt templates** across 14 categories, from multi-agent collaboration workflows to single-agent tasks like security audits, testing, debugging, and architecture reviews.

#### How to use

1. Press `Ctrl+B` to open the template browser
2. Browse categories with `Up/Down` arrows -- the preview pane on the right shows full details
3. Press `Enter` to select a template
4. Pick a target panel (`1-4`) and press `Enter` to confirm
5. If an agent is already running on that panel, the template is sent directly. If not, you'll be asked to pick an agent first -- Commander launches it and sends the template automatically.

#### Categories

| Category | Templates | Description |
|----------|-----------|-------------|
| **Collaboration** | 28 | Multi-agent workflows using Commander protocol (code review, security audit, TDD, broadcast kickoff, reply chains, etc.) |
| **Testing** | 12 | Unit tests, integration tests, E2E, property-based, mutation testing, load testing, accessibility |
| **Security** | 10 | OWASP top 10, dependency scanning, secrets detection, auth review, cryptography, compliance |
| **Code Quality** | 10 | Code smells, complexity, SOLID, DRY, error handling, tech debt, type safety |
| **Architecture** | 8 | Design patterns, microservices, event-driven, scalability, resilience, state management |
| **Debugging** | 8 | Root cause analysis, memory leaks, race conditions, flaky tests, performance profiling |
| **DevOps** | 8 | CI/CD, Dockerfiles, IaC, monitoring, deployment strategies, GitHub Actions |
| **Frontend** | 8 | Responsive design, components, web performance, CSS, forms, i18n, PWA |
| **Backend** | 6 | REST APIs, query optimization, caching, background jobs, webhooks, rate limiting |
| **Learning** | 6 | Code walkthroughs, pattern recognition, idioms, concept explainers, best practices |
| **Data** | 4 | Schema design, migrations, GraphQL, data validation |
| **Documentation** | 4 | API docs, onboarding guides, ADRs, changelogs |
| **Project** | 4 | Feature breakdown, tech spikes, release readiness, retrospectives |
| **Single Agent** | 4 | Codebase analysis, performance optimization, explain and document, migration assistant |

#### Custom templates

Create your own templates in `~/.agents-commander/templates/`. Each template is a `.md` file with YAML frontmatter:

```markdown
---
name: My Custom Template
description: One-line description shown in the browser
category: my-category
agents: [any]
panels: 1
---
Your prompt content here. This is what gets sent to the agent.

You can include multiple paragraphs, markdown formatting,
numbered steps, or any other text.
```

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name in the template browser |
| `description` | Yes | One-line description shown in the preview |
| `category` | Yes | Category for grouping (e.g., `testing`, `security`, or your own) |
| `agents` | Yes | Recommended agents: `[any]`, `[claude]`, `[claude, codex]`, etc. |
| `panels` | Yes | Recommended number of panels: `1`, `2`, or `3` |

User templates override built-in templates with the same filename. Templates are reloaded each time you open the browser (`Ctrl+B`).

### Example Workflows

**Code Review Pipeline**
```
Panel 1 (Claude):  "Review src/ for bugs"
        Claude finds issues  -->  sends to Codex
Panel 2 (Codex):   Receives issues, writes fixes
        Codex finishes  -->  sends results back to Claude
Panel 1 (Claude):  Verifies fixes, reports summary
```

**Multi-Perspective Security Audit**
```
Panel 1 (Claude):  Architecture review
Panel 2 (Gemini):  Security analysis
Panel 3 (Codex):   Writes patches based on both reviews
```

**Divide and Conquer**
```
"Split this refactor: send backend changes to Codex in Panel 2,
frontend changes to Gemini in Panel 3, and write integration
tests yourself."
```

## Keyboard Shortcuts

### Function Keys

| Key | Action |
|-----|--------|
| `F1` | Help |
| `F2` | Launch Agent |
| `F3` | Add Panel |
| `F4` | View File |
| `F5` | Edit File |
| `F6` | Copy |
| `F7` | Move / Rename |
| `F8` | Create Directory |
| `F9` | Delete |
| `F10` | Quit |

### Navigation

| Key | Action |
|-----|--------|
| `Tab` | Switch between panels |
| `Up/Down` | Move cursor / scroll |
| `Enter` | Open directory or file |
| `Backspace` | Parent directory |
| `Home/End` | Jump to first/last |
| `PgUp/PgDn` | Scroll page |
| `Insert` | Select/deselect file |

### Agent Management

These shortcuts work everywhere, including on terminal panels with running agents:

| Key | Action |
|-----|--------|
| `Ctrl+B` | Browse prompt template library |
| `Ctrl+O` | Orchestrate -- send task to any agent |
| `Ctrl+P` | Inject protocol into active agent |
| `Ctrl+T` | Toggle panel: file <-> terminal |
| `Ctrl+K` | Kill running session on active panel |
| `Ctrl+W` | Remove active panel |
| `Ctrl+C` | Send interrupt to agent |
| `Ctrl+D` | Send EOF to agent |

### Layout & System

These shortcuts pass through to agents on terminal panels (use from a file panel via `Tab`):

| Key | Action |
|-----|--------|
| `Ctrl+2/3/4` | Switch to 2/3/4 panel layout |
| `Ctrl+E` | Reset to default 2-panel view |
| `Ctrl+G` | Edit selected file in Vim |
| `F12` | Inter-agent communication guide |
| `Ctrl+H` | Toggle hidden files |
| `Ctrl+R` | Refresh all panels |
| `Ctrl+L` | View application logs |

## Configuration

Create `~/.agents-commander/config.json`:

```json
{
  "theme": "midnight",
  "panelCount": 2,
  "showHidden": false,
  "sortBy": "name",
  "watchDebounce": 300,
  "editor": {
    "tabSize": 2,
    "wordWrap": true
  },
  "agents": {
    "claude": {
      "command": "claude",
      "args": [],
      "env": {}
    }
  }
}
```

### Themes

- `classic-blue` -- Blue panels, cyan highlights. The classic look.
- `midnight` -- Dark background, blue accents.

## Architecture

```
src/
  app.ts                    # Main application, key bindings, lifecycle
  panels/
    file-panel.ts           # Dual-panel file browser
    terminal-panel.ts       # PTY-backed agent terminal with key forwarding
    preview-panel.ts        # Full-screen file viewer
    vterm.ts                # Virtual terminal emulator (ANSI/xterm)
  orchestration/
    protocol.ts             # Inter-agent protocol scanner & builder
    orchestrator.ts         # Task routing, agent lifecycle management
  agents/
    agent-manager.ts        # Agent process lifecycle
    agent-registry.ts       # Auto-discovery of installed CLI agents
    types.ts                # Agent type definitions & known agents list
    pty-helper.py           # PTY allocator (cross-platform)
  screen/
    layout-manager.ts       # 2-4 panel dynamic layout engine
    function-bar.ts         # Bottom menu bar (F-keys)
    status-bar.ts           # Status line
    toast.ts                # Toast notifications
    dialog/                 # Help, agent picker, orchestrate, template browser,
                            # protocol guide, confirm, input, log viewer
  editor/
    markdown-editor.ts      # Built-in text editor
  file-manager/
    file-operations.ts      # Copy, move, delete, mkdir
    file-watcher.ts         # Real-time filesystem monitoring
    file-system.ts          # Directory reading & file info
  templates/
    types.ts                # PromptTemplate interface
    loader.ts               # Template loader (builtin + user custom)
    builtin/                # 120 built-in prompt templates (.md with frontmatter)
  config/
    themes.ts               # Color themes
    loader.ts               # Config file loader (~/.agents-commander/)
    defaults.ts             # Default configuration
  utils/
    dialog-state.ts         # Shared dialog depth counter
    events.ts               # Application event bus
    logger.ts               # File-based debug logger
    format.ts               # Date/size formatting
```

## How the Terminal Works

Each agent panel runs a real pseudo-terminal. This means:

- Full TUI support -- agents that use `blessed`, `ink`, or `curses` work correctly
- xterm-256color with ANSI escape sequence processing
- Real-time key forwarding (each keystroke is mapped to its ANSI sequence and sent to stdin)
- A custom `VTerm` virtual terminal emulator processes the output for display in the blessed UI

This is not a dumb pipe. It's a terminal emulator inside a terminal emulator.

## Requirements

- **Node.js** >= 18.0.0
- **macOS** or **Linux** (PTY support required)
- At least one AI agent CLI installed:
  - `npm i -g @anthropic-ai/claude-code`
  - `npm i -g @openai/codex`
  - `npm i -g @google/gemini-cli`

## Why Not Just Use tmux?

| | tmux | Agents Commander |
|---|---|---|
| Side-by-side agents | Yes | Yes |
| File manager | No | Yes |
| Agents talk to each other | No | **Yes** |
| Auto-launch & route tasks | No | **Yes** |
| Protocol injection | No | **Yes** |
| One-key agent switching | No | **Yes** |
| Built-in orchestration | No | **Yes** |

## Roadmap

- [x] Claude, Codex, Gemini full support
- [x] Prompt template library (`Ctrl+B`)
- [ ] Aider, Cline, OpenCode, Goose, Kiro, Amp support
- [ ] Task queue -- chain agent tasks in sequence
- [ ] Agent memory -- persistent context across sessions
- [ ] Plugin system for custom agents
- [ ] Session save/restore
- [ ] Conversation logging & replay

## License

CC-BY-NC-4.0 — Creative Commons Attribution-NonCommercial 4.0 International

---

<p align="center">
  <b>Stop copy-pasting between AI agents.</b><br>
  Let them work together.
</p>
