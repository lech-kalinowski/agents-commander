# Agents Commander

Dual-panel terminal UI for managing multiple AI agent CLIs.

## Project Structure
- `v1/` — Original blessed-based app (production, feature-complete)
- `v2/` — Ink (React) rewrite (in progress)
- `presentation/` — Protocol demo PowerPoint + generation scripts
- `landing-page/` — GitHub Pages landing page (index.html, logo)
- `assets/` — Shared assets (logo, themes)
- `example/`, `examples/` — Demo files for testing file panel

## v1 (blessed)
```bash
cd v1 && npm run build && npm start
```
- Tech: TypeScript + blessed + chokidar + marked + tsup
- `v1/src/app.ts` — Main app, key bindings
- `v1/src/screen/` — UI components, dialogs, layout manager
- `v1/src/panels/` — File panel, preview panel, terminal panel
- `v1/src/orchestration/` — Inter-agent protocol (SEND, REPLY, BROADCAST, STATUS, QUERY)
- `v1/src/agents/` — Agent registry, manager, PTY helper
- `v1/src/templates/` — 120+ prompt templates
- `v1/src/editor/` — Built-in Markdown editor

## v2 (Ink / React)
```bash
cd v2 && npm run build && npm start
```
- Tech: TypeScript + Ink + React + chalk + tsup
- `v2/src/App.tsx` — Root React component
- `v2/src/components/` — Ink UI components (panels, bars, dialogs)
- `v2/src/hooks/` — React hooks (useFilePanel, useLayout, useTerminal)
- `v2/src/state/` — App state (reducer, context)
- Reuses v1 non-UI modules: agents, orchestration, config, templates, file-manager, skills, utils

## Key Conventions
- All imports use `.js` extension (ESM)
- F-keys: F1=Help, F2=Agent, F3=+Panel, F4=View, F5=Edit, F6=Copy, F7=Move, F8=Mkdir, F9=Delete, F10=Quit
- Ctrl+B opens the prompt template browser dialog
- Panels support 2/3/4 layout modes (Ctrl+2/3/4)
- marked-terminal renderer methods must be extracted and bound to avoid marked v15 compat issues
