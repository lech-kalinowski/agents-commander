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

## Key Conventions

- All imports use `.js` extension (ESM)
- F-keys: F1=Help, F2=Agent, F3=+Panel, F4=View, F5=Edit, F6=Copy, F7=Move, F8=Mkdir, F9=Delete, F10=Quit
- Ctrl+B opens the prompt template browser dialog
- Ctrl+P sends Commander Protocol instructions to the active running agent
- F12 opens routed-message Activity; Shift+F12 opens the protocol guide
- Panels support 2/3/4 layout modes (Ctrl+2/3/4)
- marked-terminal renderer methods must be extracted and bound to avoid marked v15 compat issues
