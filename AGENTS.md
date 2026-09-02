# Agents Commander

Multi-panel terminal UI for managing AI agent CLIs and routing text-based messages between them.

## Project Structure

- `bin/` — CLI entrypoint and launch flags
- `src/` — TypeScript application source
- `src/screen/` — blessed UI, layout, bars, toasts, and dialogs
- `src/panels/` — File, preview, terminal, and virtual-terminal panels
- `src/orchestration/` — SEND, REPLY, BROADCAST, STATUS, and QUERY routing
- `src/agents/` — Supported adapters, agent registry, lifecycle management, and PTY helper
- `src/templates/` — Loader plus 121 built-in prompt templates
- `src/demo/` — Deterministic offline conference-demo runtime
- `src/doctor/` — Startup diagnostics
- `src/hardware/` — Experimental Codex Micro input bridge and guarded controls
- `docs/` — Protocol references, setup guides, and explicitly labelled proposals
- `tests/` — Unit, integration, and built-package checks
- `presentation/` — Canonical conference PowerPoint + speaker runbook
- `landing-page/` — GitHub Pages landing page
- `assets/` — Shared visual assets
- `Example/` — Sample files for exercising the file panel

## Development

```bash
npm install
npm run build
npm start
```

Run the complete validation sequence before handoff:

```bash
npm run verify
```

The current UI uses TypeScript, blessed, chokidar, and tsup. Runtime support is Node.js 22+, Python 3, and macOS/Linux/WSL2.

Source is version 0.1.5; public npm was still 0.1.4 when checked on 2026-09-02.
Use `node dist/bin/agents-commander.js` or `npm start --` to exercise this checkout,
not an older global installation. Recheck the registry before changing release
claims. A source push is not an npm release.

## Key Conventions

- All imports use `.js` extension (ESM)
- F-keys: F1=Help, F2=Agent, F3=+Panel, F4=View, F5=Edit, F6=Copy, F7=Move, F8=Mkdir, F9=Delete, F10=Quit
- Ctrl+B opens the prompt template browser dialog
- Ctrl+P sends Commander Protocol instructions to the active running agent
- F11 opens the panel navigator
- F12 opens routed-message Activity; Shift+F12 opens the protocol guide
- Up to 100 active panels use stable numbers in a paged workspace; hidden sessions keep running
- Shift+F4 cycles auto/2/3/4 visible density independently of active panel count; Ctrl+0/2/3/4 are terminal-dependent aliases
- REPLY claims the latest open reply window, not a permanent last-sender address
- Activity is bounded and in-memory; diagnostic logs are not session recordings. Capture/export are proposed in `docs/session-capture-plan.md`, not implemented
- marked-terminal renderer methods must be extracted and bound to avoid marked v15 compat issues
