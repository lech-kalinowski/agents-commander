# Agents Commander

Multi-panel terminal UI for managing AI agent CLIs and routing text-based messages between them.

## Build & Run

```bash
npm install
npm run build
npm start
```

Use Node.js 22+, Python 3, and macOS/Linux/WSL2. Source is version 0.1.5;
public npm was still 0.1.4 when checked on 2026-09-02. Run the local build with
`node dist/bin/agents-commander.js` or `npm start -- <options> <directory>`.
Do not confuse an older global installation with this checkout; pushing source
does not publish npm. See `AGENTS.md` and README for the current conventions.

## Project Structure

- `bin/` — CLI entrypoint and launch flags
- `src/app.ts` — Main app, key bindings
- `src/screen/` — UI components, dialogs, layout manager
- `src/panels/` — File panel, preview panel, terminal panel
- `src/orchestration/` — Inter-agent protocol (SEND, REPLY, BROADCAST, STATUS, QUERY)
- `src/agents/` — Agent registry, manager, PTY helper
- `src/templates/` — Loader plus 121 built-in prompt templates
- `src/demo/` — Deterministic offline conference-demo runtime
- `src/doctor/` — Startup diagnostics
- `src/hardware/` — Experimental Codex Micro bridge and guarded controls
- `src/editor/` — Built-in Markdown editor
- `src/config/` — Config loader, themes, defaults
- `src/file-manager/` — File operations, watcher, sorter
- `src/skills/` — Skills manager
- `src/utils/` — Logger, events, formatting
- `docs/` — Protocol references, setup guides, and explicitly labelled proposals
- `tests/` — Unit, integration, hardware, and built-package checks
- `presentation/` — Canonical conference PowerPoint + speaker runbook
- `landing-page/` — GitHub Pages landing page
- `assets/` — Logo, themes

## Tech

TypeScript + blessed + chokidar + marked + tsup

## Key Conventions

- All imports use `.js` extension (ESM)
- F-keys: F1=Help, F2=Agent, F3=+Panel, F4=View, F5=Edit, F6=Copy, F7=Move, F8=Mkdir, F9=Delete, F10=Quit
- Ctrl+B opens the prompt template browser dialog
- Ctrl+P sends session-bound Commander Protocol instructions to the active running agent
- F11 opens the panel navigator
- F12 opens routed-message Activity; Shift+F12 opens the protocol guide
- Up to 100 active panels use stable numbers in a paged workspace; hidden sessions keep running
- Shift+F4 cycles auto/2/3/4 visible density independently of active panel count; Ctrl+0/2/3/4 are terminal-dependent aliases
- REPLY claims the latest open reply window, not a permanent last-sender address
- Activity is bounded and in-memory; diagnostic logs are not session recordings. Capture/export are proposed in `docs/session-capture-plan.md`, not implemented
- marked-terminal renderer methods must be extracted and bound to avoid marked v15 compat issues

## Testing

Run the complete validation sequence before handoff:

```bash
npm run verify
```

This runs TypeScript checks, Vitest unit/integration tests, Python hardware
bridge tests, the build, CLI isolation checks, and packed-install smoke tests.
