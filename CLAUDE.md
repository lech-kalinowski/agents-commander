# Agents Commander

Multi-panel terminal UI for managing AI agent CLIs and routing text-based messages between them.

## Build & Run

```bash
npm install
npm run build
npm start
```

Use Node.js 22+, Python 3, and macOS/Linux/WSL2. Package version is 0.1.8,
under the MIT License. Version 0.1.4 is the legacy baseline with different
runtime requirements, features, and bundled license. The versioned install is
`npm install -g agents-commander@0.1.8`. Run the local build with
`node dist/bin/agents-commander.js` or `npm start -- <options> <directory>`.
Do not confuse an older global installation with this checkout; pushing source
does not publish npm. See `AGENTS.md` and README for the current conventions.
F2/N bulk launch, F2/P bulk protocol setup and sequenced replay protection are
included in 0.1.6, not 0.1.5. Check registry publication separately before
claiming that this version has been published.
Version 0.1.7 fixes shallow file-panel watches and installed template lookup.
Version 0.1.8 fixes refresh/navigation races, cancellable slow editor loading,
and modal focus when Vim exits in the background. Preserve these input owners.
Restart after upgrading. Do not attribute the reproduced watcher freeze to
Node.js 20; it remains unsupported, while Node.js 22+ is required.

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
- `talks/` — Conference decks and speaker runbooks, reviewed separately from the product
- `landing-page/` — GitHub Pages landing page
- `assets/` — Logo, themes

## Tech

TypeScript + blessed + native shallow filesystem watches + marked + tsup

## Key Conventions

- All imports use `.js` extension (ESM)
- F-keys: F1=Help, F2=Agent, F3=+Panel, F4=Full/Back, F5=Edit, F6=Clone, F7=Order, F8=Mkdir, F9=Close panel, F10=Quit
- F2 then N launches one selected profile into a requested number of NEW panels at the selected source directory after confirmation; existing sessions remain untouched. Esc stops remaining launches. No automatic protocol/task/capture; shared CWD and configured resume/startup effects are preserved.
- F4 toggles active-panel fullscreen; F4 again restores the grid without restarting sessions
- F6 opens a new panel at the same directory and starts a fresh instance of the same agent profile, not its conversation, process state, or protocol capability; it does not copy files
- F7 changes workspace position only; stable P IDs and routing/session identity must not change
- Enter previews files; Shift+F6/Shift+F7/Shift+F9 copy/move/delete files from file panels; Ctrl+W remains the close-panel alias
- Ctrl+B opens the prompt template browser dialog
- File auto-refresh uses one shallow native handle per distinct file-panel directory, at most 100. Navigation updates the watched roots; failed watches stop and Ctrl+R provides manual refresh from a file panel. Successful events must not write logs; installed built-ins must resolve from their package, not the working directory.
- Ctrl+P sends session-bound Commander Protocol instructions to the active running agent
- F2 then P explicitly injects protocol into selected/all running agent profiles after confirmation. Each exact session gets its own key; already-armed sessions are skipped, replacements are never followed. Esc stops remaining work after an in-flight paste/submit settles. Built-in Shell/internal demos are excluded. Verify empty ready CLI prompts first; no automatic task/capture.
- F11 opens the panel navigator
- F12 opens routed-message Activity; Shift+F12 opens the protocol guide
- Up to 100 active panels use stable numbers in a paged workspace; hidden sessions keep running
- Shift+F4 cycles auto/2/3/4 visible density independently of active panel count; Ctrl+0/2/3/4 are terminal-dependent aliases
- REPLY claims the latest open reply window, not a permanent last-sender address
- Protocol 0.1.6 instructions use one positive per-capability counter across all five verbs, matching header and END footer. New actions increment it; redraws retain it. Bounded local replay protection survives scrolling/resize; legacy hard-reflow remains ambiguous. Explicit Ctrl+P rotates the key, while F2/P skips already-armed sessions.
- Activity is bounded and in-memory; diagnostic logs are not session recordings. Capture/export require explicit launch consent and human review; see `docs/datasets.md` and the broader proposed roadmap in `docs/session-capture-plan.md`
- Dataset commands stay UI-independent. Do not enable recording from config, export unapproved data, keep live capability keys, or commit/package private research artifacts
- marked-terminal renderer methods must be extracted and bound to avoid marked v15 compat issues

## Testing

Run the complete validation sequence before handoff:

```bash
npm run verify
```

This runs TypeScript checks, Vitest unit/integration tests, Python hardware
bridge tests, the build, CLI isolation checks, and packed-install smoke tests.
