# Agents Commander

Dual-panel terminal UI for managing multiple AI agent CLIs.

## Build & Run
```bash
npm install && npm run build && npm start
```

## Project Structure
- `src/app.ts` — Main app, key bindings
- `src/screen/` — UI components, dialogs, layout manager
- `src/panels/` — File panel, preview panel, terminal panel
- `src/orchestration/` — Inter-agent protocol (SEND, REPLY, BROADCAST, STATUS, QUERY)
- `src/agents/` — Agent registry, manager, PTY helper
- `src/templates/` — 120+ prompt templates
- `src/editor/` — Built-in Markdown editor
- `src/config/` — Config loader, themes, defaults
- `src/file-manager/` — File operations, watcher, sorter
- `src/skills/` — Skills manager
- `src/utils/` — Logger, events, formatting
- `presentation/` — Protocol demo presentation
- `landing-page/` — GitHub Pages landing page
- `assets/` — Logo, themes

## Tech
TypeScript + blessed + chokidar + marked + tsup

## Key Conventions
- All imports use `.js` extension (ESM)
- F-keys: F1=Help, F2=Agent, F3=+Panel, F4=View, F5=Edit, F6=Copy, F7=Move, F8=Mkdir, F9=Delete, F10=Quit
- Ctrl+B opens the prompt template browser dialog
- Panels support 2/3/4 layout modes (Ctrl+2/3/4)
- marked-terminal renderer methods must be extracted and bound to avoid marked v15 compat issues

## Testing
```bash
npm test
```
- Tests use vitest, located in `tests/unit/`
