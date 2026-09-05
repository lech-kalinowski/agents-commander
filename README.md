<p align="center">
  <br>
  <img width="160" src="assets/logo.png" alt="Agents Commander — pixel &gt;/&lt; mark in cyan and yellow on classic blue">
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
  <a href="#quick-start">Install</a> &bull;
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

This README describes the **source development version 0.1.5**. The public npm
release is still **0.1.4**, verified on 2026-09-02. A git push does not publish a
new npm package.

### Current source version

Use Node.js 22+ and build the current development branch:

```bash
git clone --branch codex/review-and-release-0.1.5 https://github.com/lech-kalinowski/agents-commander.git
cd agents-commander
npm install
npm run build
node dist/bin/agents-commander.js --doctor .
node dist/bin/agents-commander.js .
```

If you already have this source checkout, skip cloning. Run the commands from
the checkout; replace `.` with your project directory. The source examples
below use the built entrypoint so an older global installation cannot shadow it.
`npm start -- <options> <directory>` is an equivalent source launch command.

`--doctor` checks the runtime, PTY bridge, packaged assets, and working directory
before the TUI starts. Commander is a local terminal application; the website is
a landing page, not a browser-hosted Commander interface.

### Published npm release (legacy 0.1.4)

```bash
npm install -g agents-commander@0.1.4
agents-commander --version
agents-commander --panels 2 .
```

Published 0.1.4 advertises Node.js 18+ and supports `--theme`, `--panels` (2, 3,
or 4), and `--show-hidden`, plus help/version. It does **not** include the source
version's `--doctor`, `--conference`, `--demo`, `--density`, 100-panel workspace,
OpenCode adapter, or Codex Micro integration. Use the source build for those
features. Check the [npm package](https://www.npmjs.com/package/agents-commander)
for later releases; this documentation update does not publish one.

---

## The Problem

You have Claude Code, Codex CLI, Gemini CLI. All powerful. All isolated. You copy-paste between them like it's 2005.

**Agents Commander puts them in one terminal, side by side, and lets them talk to each other.**

## Requirements

For source 0.1.5:

- Node.js 22 or newer
- Python 3 (used by the PTY bridge)
- macOS, Linux, or WSL2
- For live AI sessions: Claude Code, Codex CLI, Gemini CLI, or OpenCode. The supported Shell adapter can launch a local interactive shell or a configured command.

The deterministic offline demo does not require an AI agent CLI, API credentials, or network access.

## Demo

Use the presentation-safe preset with live agent CLIs:

```bash
node dist/bin/agents-commander.js --conference .
```

Conference Mode uses the `midnight` theme, starts with two panels, hides dotfiles, and skips the welcome dialog. To rehearse without external services, launch the bundled deterministic demo:

```bash
node dist/bin/agents-commander.js --demo
```

Demo Mode creates a temporary seeded workspace, applies the Conference Mode defaults, and offers to launch two bundled local demo roles. The workspace is cleaned up when Commander exits.
The compact sketch below omits the demo session's capability suffix from protocol markers.

```
+---------------------------+---------------------------+
| Panel 1: Demo Coordinator | Panel 2: Demo Reviewer    |
| Seeded workspace ready.   | Waiting for coordinator.  |
|                           |                           |
| ===COMMANDER:SEND:        | [From Demo Coordinator]   |
| generic:2===              | Review brief.md; total?   |
| Review brief.md. Confirm  |                           |
| total=42.                 | STATUS: seeded total 42.  |
| ===COMMANDER:END===       |                           |
|                           | ===COMMANDER:REPLY===     |
| ACK msg=m1 thread=t1      | Deterministic review     |
|                           | passed: total=42.         |
|                           | ===COMMANDER:END===       |
|                           |                           |
+---------------------------+---------------------------+
 F1Help F2Agent F3+Panel F4Full F5Edit F6Clone F7Order F8Mkdir F9Close F10Quit
```

## Features

### Multi-Agent Terminal

Keep up to **100 active panels** in one workspace. A panel can be a file browser or a PTY-backed agent terminal with ANSI/xterm-256color rendering for common interactive CLI output. Type directly into any agent -- keystrokes are forwarded in real-time.

The workspace size and the visible layout are separate:

- `--panels <1-100>` chooses how many active panels exist when Commander starts.
- `--density auto|2|3|4` chooses how many panels can be visible on one page. `auto` fits as many readable panels as the window allows; `2`, `3`, and `4` set a manual cap.
- `Shift+F4` reliably cycles `auto` / `2` / `3` / `4` density without creating, removing, or restarting panels. `Ctrl+0`, `Ctrl+2`, `Ctrl+3`, and `Ctrl+4` remain direct aliases on terminals that emit those combinations distinctly.
- `Tab` moves through every active panel and brings its page into view. Terminal sessions on hidden pages keep running.
- `F4` expands the active panel to fullscreen; press `F4` again (`Back` in the function bar) to restore the grid. The configured density and running sessions are preserved.
- `F6` opens a new panel at the active panel's working directory and launches a **fresh instance of the same agent profile** when it has one. It does not copy files. Conversations, terminal buffers, running process state, and protocol capability keys are not copied.
- `F7` changes a panel's workspace position. `F9` closes the active panel, with confirmation before stopping a live session; it never deletes files.

For example, this creates a 12-panel workspace while showing no more than four panels at once:

```bash
node dist/bin/agents-commander.js --panels 12 --density 4 .
```

Protocol panel IDs (`P1`, `P2`, and so on) are stable for the lifetime of the workspace, independently of workspace order. Moving Panel 3 to position 1 with `F7` does not change its `P3` route; removing Panel 2 does not renumber Panel 3. Gaps are normal. Newly added or cloned panels receive new IDs; `Ctrl+E` is the explicit reset to fresh Panels 1 and 2.

Cloning a managed agent keeps its configured profile (including its configured model), but starts a separate session. Press `Ctrl+P` in that new agent to enable its own Commander Protocol session. An unmanaged command, such as Vim, is not replayed: its clone is an idle terminal at the same directory. The bundled scripted demo roles cannot be cloned; use `F3` and `F2` to launch an independent agent instead.

Supported adapters:

- **Claude Code** (Anthropic)
- **Codex CLI** (OpenAI)
- **Gemini CLI** (Google)
- **OpenCode** (multi-provider, including custom `provider/model` profiles)
- **Shell** (a generic local shell or configured command)

The selector also catalogues five future presets that are not launchable yet: Aider, Cline, Goose, Kiro, and Amp.

### Sixteen-panel APEX collaboration example

The [APEX review council](Example/apex-sixteen-panel/README.md) prepares sixteen
named Pi or OpenCode profiles: one coordinator and fifteen specialists reviewing a
fictional booking API in seven human-gated waves. It includes an offline setup
generator, role prompts, a runbook, and a 15-SEND/15-REPLY evidence checklist.
Supply the exact APEX model and the provider setup for your chosen harness;
no provider identity or live-model compatibility is assumed. Preparation does
not launch agents or change your saved configuration. This is a source-checkout
example, not the two-agent scripted `--demo` or a verified APEX benchmark.
The [Pi setup guide](Example/apex-sixteen-panel/PI.md) includes private credential
loading, profile registration and a live model smoke command.

### Integrated File Manager

A file manager built into every file panel. Browse, copy (`Shift+F6`), move or rename (`Shift+F7`), and delete (`Shift+F9`) files without leaving the tool. These file operations only apply to file panels; unmodified `F6`, `F7`, and `F9` control panels. Toggle between file panels and agent terminals with `Ctrl+T`.

### Inter-Agent Communication

The killer feature. Agents can **autonomously send tasks to each other** using a lightweight protocol. Routing uses local output markers instead of a separate orchestration API or SDK.

### Built-in Editor

Preview regular UTF-8 text files with line numbers using `Enter` from a file panel, edit them in the built-in text editor with `F5`, or open the selected file in Vim with `Ctrl+G`.

### Themes

Choose between the built-in `classic-blue` and `midnight` themes through the CLI or configuration file.

## Inter-Agent Communication

This is what makes Agents Commander different from running `tmux` with multiple agents.

### How it works

1. **Launch agents** in different panels (`F2`)
2. **Send protocol instructions** to each running agent (`Ctrl+P`) -- the instructions are written directly to that agent's terminal session
3. **Give a task** that requires collaboration:

```
"Analyze this codebase for security issues, then ask Codex in Panel 2
to fix every vulnerability you find."
```

4. **Watch it happen.** Claude analyzes, finds issues, sends them to Codex. Codex fixes, reports back.

### The Protocol

Five commands, one session-bound routing capability. `Ctrl+P` generates a fresh private capability for that agent session and teaches the agent the exact marker format. Static or copied markers without the current capability are inert. In the examples below, `<session-key>` stands for the value injected into the agent.

**SEND** -- direct message to a specific agent:
```
===COMMANDER:SEND:codex:2:<session-key>===
Please write unit tests for the auth module.
===COMMANDER:END:<session-key>===
```

**REPLY** -- continue your latest open reply thread (no panel number needed):
```
===COMMANDER:REPLY:<session-key>===
Tests written. 12 passing, 0 failing.
===COMMANDER:END:<session-key>===
```

Commander claims the newest open reply window and resolves its return session.
A successful delivery consumes that window; a failed delivery can restore it
if the route is still valid. This is not a permanent "last sender" address.

**BROADCAST** -- send to every other connected agent at once:
```
===COMMANDER:BROADCAST:<session-key>===
Phase 1 complete. All agents: begin phase 2.
===COMMANDER:END:<session-key>===
```

**STATUS** -- report progress (shown as a toast in Commander UI, not sent to agents):
```
===COMMANDER:STATUS:<session-key>===
Analyzing file 5 of 10...
===COMMANDER:END:<session-key>===
```

**QUERY** -- ask Commander what agents are running:
```
===COMMANDER:QUERY:<session-key>===
agents
===COMMANDER:END:<session-key>===
```

Commander's `ProtocolScanner` watches agent output in real-time, strips ANSI codes, detects these markers across streaming chunks, and routes a message only when its capability matches the currently armed session. The target agent sees:

```
[From Claude Code in Panel 1 | thread=t1 | msg=m1]: Please write unit tests for the auth module...
```

After delivery, the sender gets an **ACK**:
```
[Commander ACK] status=delivered msg=m1 thread=t1 target="Codex CLI" panel=2
```

`delivered` means the input was submitted to the target PTY; it does not mean
the model accepted the task or completed it. Failed deliveries return
`status=failed` with an error. BROADCAST's ACK reports queue admission only;
subsequent per-target delivery outcomes appear in F12 Activity. STATUS returns
a local `kind=status status=accepted` ACK.

Routing is bidirectional between connected supported sessions.

### Activity, diagnostics, and recording limits

- `F12` shows SEND, REPLY, and BROADCAST delivery attempts from an in-memory
  ledger, not a persistent archive. Default retention is up to 1,000 records /
  8 MiB of content, with a 256 KiB per-record content cap; the dialog shows the
  latest 100 summaries. Evicted records and history are not restored on restart.
- STATUS and QUERY are not retained in Activity; opt-in capture records them.
- `Ctrl+L` from a file panel opens the diagnostic log at
  `~/.agents-commander/debug.log`. It rotates at 1 MiB with one backup. Routed
  payloads are represented by metadata and byte counts, not complete message
  bodies. Diagnostics can still contain names and error details; review them
  before sharing.
- Opt-in semantic recording and reviewed dataset export are available in this
  source checkout. Nothing is recorded by default. Full terminal transcripts,
  session restore, replay and model training are **not implemented**. The
  [original design plan](https://github.com/lech-kalinowski/agents-commander/blob/codex/review-and-release-0.1.5/docs/session-capture-plan.md)
  retains the broader proposed scope and implementation boundaries.

### Create a Commander Protocol training dataset

```bash
# Source build, Node.js 22+. Reuse an opaque ID across related project runs.
npm start -- --capture protocol --capture-project project-01 /path/to/project

# Arm each agent with Ctrl+P; submit tasks via Ctrl+O; exit with F10.
# The launch prints the private capture directory.
npm start -- dataset inspect /path/to/capture-uuid
npm start -- dataset prepare /path/to/capture-uuid --out ~/commander-review-01

# Review candidates and explicitly approve quality, context, privacy and rights.
# Edit review.json; decisions start unapproved.
npm start -- dataset export ~/commander-review-01 --out ~/commander-dataset-01 --seed experiment-01
npm start -- dataset validate ~/commander-dataset-01
```

Exports use conversational `prompt` / `completion` JSONL for LoRA/SFT. Audit
metadata is separate; real and synthetic examples stay separate; whole project
families and detected duplicates stay in one split. Missing/manual-input context
and incomplete captures are not silently promoted to training examples.
Redaction is best-effort and human review is mandatory. No automatic training or
uploads occur. See the [dataset guide](https://github.com/lech-kalinowski/agents-commander/blob/codex/review-and-release-0.1.5/docs/datasets.md)
for schemas, review steps, limitations and the model-specific training gate.

### Manual Orchestration

Don't want to wait for agents to figure it out? Press `Ctrl+O` to manually send a task to any agent in any panel. Commander handles launching, initialization, and delivery.

### Prompt Template Library

**121 built-in prompt templates** across 14 categories, from multi-agent collaboration workflows to single-agent tasks like security audits, testing, debugging, and architecture reviews.

#### How to use

1. Press `Ctrl+B` to open the template browser
2. Browse categories with `Up/Down` arrows -- the preview pane on the right shows full details
3. Press `Enter` to select a template
4. Pick a live target panel by its stable panel number and press `Enter` to confirm
5. Ordinary templates can launch an agent automatically. Collaboration templates first require a running agent armed with `Ctrl+P`; Commander then binds their protocol examples to that session before sending.

#### Categories

| Category | Templates | Description |
|----------|-----------|-------------|
| **Collaboration** | 29 | Multi-agent workflows using Commander protocol (code review, security audit, TDD, broadcast kickoff, reply chains, etc.) |
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

Create your own templates in `~/.agents-commander/templates/`. Each template is a `.md` file with simple YAML-like frontmatter:

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

| Field | Default | Description |
|-------|---------|-------------|
| `name` | Filename without `.md` | Display name in the template browser |
| `description` | Empty | One-line description shown in the preview |
| `category` | `other` | Category for grouping (e.g., `testing`, `security`, or your own) |
| `agents` | `[any]` | Recommended agents: `[any]`, `[claude]`, `[claude, codex]`, etc. |
| `panels` | `1` | Recommended number of active panels from `1` to `100` |

All metadata fields are optional. The lightweight parser supports the scalar and bracketed-list forms shown above; it is not a full YAML parser.

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
| `F4` | Fullscreen active panel / restore grid (`Full` / `Back`) |
| `F5` | Edit File |
| `F6` | Clone panel at the same directory and start a fresh instance of the same agent profile |
| `F7` | Change panel workspace position; keep its protocol ID |
| `F8` | Create Directory |
| `F9` | Close panel; confirm before stopping a live session |
| `F10` | Quit |

### Navigation

| Key | Action |
|-----|--------|
| `Tab` | Switch to the next active panel and bring its page into view |
| `F11` | Search and jump to any panel by number, path, agent, model, or status |
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
| `Ctrl+P` | Send protocol instructions to the active agent |
| `Ctrl+T` | Toggle panel: file <-> terminal |
| `Ctrl+K` | Kill running session on active panel |
| `Ctrl+W` | Close active panel (same as `F9`) |
| `Ctrl+C` | Send interrupt to agent |
| `Ctrl+D` | Send EOF to agent |

### Layout & System

These are global application shortcuts:

| Key | Action |
|-----|--------|
| `Shift+F4` | Cycle automatic, 2-, 3-, and 4-panel visible density |
| `Ctrl+0/2/3/4` | Terminal-dependent direct density aliases |
| `F12` | Routed-message Activity |
| `Shift+F12` | Inter-agent protocol guide |

Layout density only changes what is visible. It does not add, remove, renumber, or restart panels. Use `F3` to add, `F6` to clone, `F7` to reorder, and `F9` or `Ctrl+W` to close the active panel. `F4` toggles fullscreen and `Tab` moves across pages.

These file operations are available only from file panels:

| Key | Action |
|-----|--------|
| `Enter` | Open directory / preview selected file |
| `F5` | Edit selected file |
| `Shift+F6` | Copy selected files |
| `Shift+F7` | Move / rename selected files |
| `F8` | Create directory |
| `Shift+F9` | Delete selected files (with confirmation) |

These are file-panel actions. On terminal panels they pass through to the running agent, so switch to a file panel with `Tab` first:

| Key | Action |
|-----|--------|
| `Ctrl+E` | Reset to default 2-panel view |
| `Ctrl+G` | Edit selected file in Vim |
| `Ctrl+H` | Toggle hidden files |
| `Ctrl+R` | Refresh all panels |
| `Ctrl+L` | View application logs |

## Codex Micro controls (experimental)

Agents Commander can read the shipping Codex Micro controls directly over USB or Bluetooth on macOS. The native bridge is bundled, uses Python 3 and the device's vendor-HID channel, and does not require reprogramming the factory layer in Work Louder Input. The integration remains opt-in; native input is the default mode after it is enabled.

Native mode uses a sole-reader conflict guard. Before accepting each event, it
checks that no other active direct HID reader is attached. If ChatGPT Desktop,
Work Louder Input, or another client is reading the device, Commander shows
`MICRO:BUSY` and discards its input. This is an observational safety guard, not
an OS-enforced exclusive lock. Fully quit ChatGPT Desktop before starting
Commander. You can instead disable ChatGPT under **System Settings > Privacy &
Security > Input Monitoring**, restart ChatGPT, leave that permission enabled
for the terminal that launches Commander, and confirm that Doctor passes. Do
not use `sudo`. On the tested firmware 0.4.1, selecting Layer 2 did not isolate
the vendor events: another active client still received the same physical
press.

| Physical control | Agents Commander action |
|-----|--------|
| Agent keys 1–6 (`AG00`–`AG05`) | Focus active workspace slots 1–6 |
| Fast (`ACT06`) | Cycle visible panel density |
| Approve (`ACT07`) | Guarded one-time approval when decision controls are enabled |
| Reject (`ACT08`) | Guarded rejection when decision controls are enabled |
| Split (`ACT09`) | Add a panel |
| Wide Mic key (`ACT10` + `ACT11`) | Open routed-message Activity |
| Codex (`ACT12`) | Open the panel navigator |
| Dial counter-clockwise / clockwise | Focus previous / next panel |
| Dial press | Open routed-message Activity |
| Joystick up / down | Previous / next panel page |
| Joystick left / right | Focus previous / next panel |

The names above describe the factory keycap arrangement. The keycaps are
swappable; Commander routes the fixed `AG00`–`AG05` and `ACT06`–`ACT12`
positions, regardless of which cap is installed.

First allow your terminal application in **System Settings > Privacy & Security > Input Monitoring**, then verify the connection:

```bash
node dist/bin/agents-commander.js --doctor --codex-micro .
node dist/bin/agents-commander.js --codex-micro-test .
```

For normal opt-in operation:

```bash
node dist/bin/agents-commander.js --codex-micro .
```

Guarded Approve and Reject controls are disabled by default. Enable them explicitly only for a rehearsed session:

```bash
node dist/bin/agents-commander.js --codex-micro --codex-micro-decisions .
```

`--codex-micro-test` enables the controls for that run and opens the physical-input checklist. `--no-codex-micro` explicitly disables them. `--conference` and `--demo` do **not** enable Codex Micro automatically. Approval and rejection remain human-confirmed, fail-closed operations: a first press opens a five-second window, the same decision key confirms, and submission occurs only while the active session is Codex and the selected prompt still matches the requested one-time action. They never choose a persistent "always allow" option.

Native device input currently requires macOS. On Linux, or for a controller layer already programmed with the reserved shortcuts, use `--codex-micro-keyboard` as the legacy fallback. That fallback cannot run the sole-reader guard or decision controls, so keep ChatGPT Desktop fully quit for the entire keyboard-mode session. For the stage, prefer a wired USB-C connection, ensure `MICRO:BUSY` is not displayed, and keep a conventional keyboard available. The bridge reads controls and safe device status only; it does not read or store device serial numbers, update firmware, or control RGB lighting. See [Codex Micro setup and rehearsal](docs/codex-micro.md).

## Configuration

Create `~/.agents-commander/config.json`:

```json
{
  "theme": "midnight",
  "panelCount": 2,
  "panelDensity": "auto",
  "showHidden": false,
  "sortBy": "name",
  "sortAscending": true,
  "watchDebounce": 300,
  "editor": {
    "tabSize": 2,
    "wordWrap": true
  },
  "hardware": {
    "codexMicro": {
      "enabled": false,
      "inputMode": "native",
      "decisionControls": false
    }
  },
  "agents": {
    "claude": {
      "command": "claude",
      "args": [],
      "env": {}
    }
  },
  "agentProfiles": [
    {
      "id": "local-reviewer",
      "label": "Local Reviewer",
      "adapter": "opencode",
      "model": "provider/model-name",
      "agent": "reviewer",
      "configPath": "/absolute/path/to/opencode.json"
    }
  ]
}
```

`panelCount` is the initial active workspace size (`1` to `100`), matching `--panels`. `panelDensity` is the visible-page policy (`"auto"`, `2`, `3`, or `4`), matching `--density`. The two settings are independent.

`hardware.codexMicro.enabled` opts into the control surface. `hardware.codexMicro.inputMode` is `"native"` by default; set it to `"keyboard"` only for a Work Louder Input layer programmed with the legacy shortcuts. `hardware.codexMicro.decisionControls` separately enables guarded approval and rejection; its safe default is `false`.

`agentProfiles` adds named launch choices without removing the built-in profiles. OpenCode models use the full `provider/model` form; `agent` is optional, and `configPath` must be absolute. Keep provider credentials in your normal OpenCode authentication or environment setup rather than committing them to the repository.

### Themes

- `classic-blue` -- Blue panels, cyan highlights. The classic look.
- `midnight` -- Dark background, blue accents.

## Architecture

```
src/
  app.ts                    # Main application, key bindings, lifecycle
  panels/
    file-panel.ts           # File browser used by workspace panels
    terminal-panel.ts       # PTY-backed agent terminal with key forwarding
    preview-panel.ts        # Full-screen file viewer
    vterm.ts                # Virtual terminal emulator (ANSI/xterm)
  orchestration/
    protocol.ts             # Inter-agent protocol scanner & builder
    orchestrator.ts         # Task routing, agent lifecycle management
    message-ledger.ts       # Bounded in-memory routed messages and reply windows
  agents/
    agent-manager.ts        # Agent process lifecycle
    agent-registry.ts       # Auto-discovery of installed CLI agents
    types.ts                # Agent type definitions & known agents list
    pty-helper.py           # PTY allocator (cross-platform)
  screen/
    layout-manager.ts       # Adaptive, paged workspace for up to 100 active panels
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
    builtin/                # 121 built-in prompt templates (.md with frontmatter)
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

- PTY-backed support for interactive terminal applications
- xterm-256color with ANSI escape sequence processing
- Real-time key forwarding (each keystroke is mapped to its ANSI sequence and sent to stdin)
- A custom `VTerm` virtual terminal emulator processes the output for display in the blessed UI

This is not a dumb pipe. It's a terminal emulator inside a terminal emulator.

## What Agents Commander Adds

Agents Commander combines several local workflows in one TUI:

- up to 100 active file or PTY-backed agent panels in an adaptive, paged workspace
- integrated file browsing and file operations in any file panel
- text-marker scanning and routed SEND, REPLY, BROADCAST, STATUS, and QUERY messages
- one-key protocol instruction delivery, manual orchestration, and routed-message Activity
- a built-in library of 121 prompts

## Roadmap

- [x] Supported Claude Code, Codex CLI, Gemini CLI, OpenCode, and Shell adapters
- [x] Prompt template library (`Ctrl+B`)
- [ ] Aider, Cline, Goose, Kiro, Amp support
- [ ] Task queue -- chain agent tasks in sequence
- [ ] Agent memory -- persistent context across sessions
- [ ] Plugin system for custom agents
- [ ] Session save/restore
- [x] [Opt-in semantic capture and reviewed LoRA/SFT dataset export](https://github.com/lech-kalinowski/agents-commander/blob/codex/review-and-release-0.1.5/docs/datasets.md)
- [ ] Conversation replay

## License

Source-available under CC-BY-NC-4.0 — Creative Commons Attribution-NonCommercial 4.0 International. Commercial use is not licensed by this project.

---

<p align="center">
  <b>Stop copy-pasting between AI agents.</b><br>
  Let them work together.
</p>
