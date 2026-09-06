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
- `src/capture/` — Opt-in private semantic recorder, redaction, manifests and strict reader
- `src/dataset/` — Offline candidate review, split-safe conversational JSONL export and validation
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
- F-keys: F1=Help, F2=Agent, F3=+Panel, F4=Full/Back, F5=Edit, F6=Clone, F7=Order, F8=Mkdir, F9=Close panel, F10=Quit
- F4 toggles active-panel fullscreen; F4 again restores the grid without restarting sessions
- F6 opens a new panel at the same directory and starts a fresh instance of the same agent profile, not its conversation, process state, or protocol capability; it does not copy files
- F7 changes workspace position only; stable P IDs and routing/session identity must not change
- Enter previews files; Shift+F6/Shift+F7/Shift+F9 copy/move/delete files from file panels; Ctrl+W remains the close-panel alias
- Ctrl+B opens the prompt template browser dialog
- Ctrl+P sends Commander Protocol instructions to the active running agent
- F11 opens the panel navigator
- F12 opens routed-message Activity; Shift+F12 opens the protocol guide
- Up to 100 active panels use stable numbers in a paged workspace; hidden sessions keep running
- Shift+F4 cycles auto/2/3/4 visible density independently of active panel count; Ctrl+0/2/3/4 are terminal-dependent aliases
- REPLY claims the latest open reply window, not a permanent last-sender address
- Activity is bounded and in-memory; diagnostic logs are not session recordings. Capture/export require explicit launch consent and human review; see `docs/datasets.md` and the broader proposed roadmap in `docs/session-capture-plan.md`
- Dataset commands must remain UI-independent; never enable recording from saved config, export unapproved data, retain live capability keys, or include private research artifacts in git/npm
- marked-terminal renderer methods must be extracted and bound to avoid marked v15 compat issues
