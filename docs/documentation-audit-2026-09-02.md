# Documentation audit — 2026-09-02

Scope: source `0.1.5` at `001e903`, README, CLI/help/welcome/protocol guide,
contributor instructions, landing page and protocol research documents.
**Initial result: not fully synchronized. Resolution: the findings below were
addressed in this update.** The table preserves the baseline locations and
original recommendations; line numbers may have moved. Capture/export/training
remain proposed, not implemented. No npm release was performed.

## Findings

| Priority | Location at audit baseline | Finding and recommended change |
| --- | --- | --- |
| P1 | `README.md:43`; `landing-page/index.html:1846` | Unqualified npm installation is followed by current-source flags. Public npm is still 0.1.4; its CLI has only theme, 2/3/4 panels and show-hidden options. Clearly separate published 0.1.4 usage from source 0.1.5 doctor/demo/conference/density/Micro features; provide a source-build path. A source push does not publish npm. |
| P2 | `landing-page/index.html:1735` | The format diagram omits the required capability in header/footer. Add the per-session key and explain Ctrl+P; legacy examples are inert in armed routing. |
| P2 | `landing-page/index.html:1649` | “4 Supported Adapters” and OpenCode listed as future are stale. Source supports five: Claude Code, Codex CLI, Gemini CLI, OpenCode and Shell. The future five are Aider, Cline, Goose, Kiro and Amp. |
| P2 | `src/screen/dialog/protocol-dialog.ts:96` | ACK examples use obsolete prose. Show current structured ACKs, separate broadcast/per-target and STATUS behavior, and explain delivered means PTY input submitted—not task completed. |
| P2 | `docs/commander-protocol-commercial.md:175` | Commercial-use discussion omits the project's CC-BY-NC-4.0 qualification. Distinguish potential applications from license permissions; reference LICENSE rather than imply a commercial grant. |
| P3 | `CLAUDE.md:3`; `AGENTS.md`; `src/screen/dialog/welcome-dialog.ts:41` | Dual-panel / 2–4 layout descriptions lag 100 active panels, auto-fit and pagination. Synchronize overview, current shortcuts, 121 templates and `npm run verify`. |
| P3 | `README.md:179`; `src/screen/dialog/help-dialog.ts:56`; `src/screen/dialog/protocol-dialog.ts:56` | “Last sender” is imprecise: REPLY claims the latest open reply window. Explain consumed windows, resolved routes and failure restoration. |
| P3 | Three `docs/commander-protocol-*.md` research documents | Unexplained “v11” does not identify source package 0.1.5. Replace with explicit version/commit scope and distinguish proposals from implementation. |

Published-package evidence was checked against registry metadata and the
read-only extracted 0.1.4 tarball CLI, not inferred from package.json.
Public 0.1.4 advertises Node >=18; current source requires Node >=22.
Recheck the registry when fixing release instructions.

## Logging limitation to document

Ctrl+L opens a rotating diagnostic log, not a full conversation archive.
F12 shows bounded in-memory SEND/REPLY/BROADCAST history, with default ledger
limits of 1,000 records / 8 MiB and 256 KiB per-record content. Its UI shows the
latest 100 summaries. STATUS/QUERY are live-only. Durable communication capture,
terminal transcripts, dataset export and replay are not implemented.

Add this distinction near logging/Activity documentation. Link to the
[proposed capture plan](session-capture-plan.md) without advertising proposed
commands as available features.

## Already aligned

The README correctly describes five source adapters, 121 templates and category
counts, active panels versus visible density, principal key bindings, and the
current native/fallback Micro behavior. The presentation runbook separates the
public package from the source demo. The existing roadmap correctly leaves
logging/replay and session restoration unchecked.

## Fix order and review gate

1. Correct public-vs-source onboarding and landing-page protocol/adapters.
2. Synchronize in-app help/guide/welcome and contributor instructions.
3. Qualify research/version/license language and add logging limitations.
4. Add assertions for CLI help, critical protocol examples, adapter/template
   counts and package-source distinctions where practical.
5. Pre/post-change CR, full `npm run verify`, browser check of landing-page
   changes, then scoped commit/push. Do not publish npm without a separate
   release decision.

## Resolution record

- Corrected README and landing-page release instructions, adapter counts,
  session-key examples, REPLY/ACK wording and recording limitations.
- Synchronized help, protocol guide, welcome copy, AGENTS and CLAUDE instructions;
  qualified research version, historical research and license claims.
- Added 19 focused documentation/brand tests; full verification passed with
  673 application tests and 28 hardware tests.
- Applied the user-approved retro identity to the README, landing page and
  conference deck, preserving Callstack styling and the 45-minute session.
  The [brand guide](../assets/BRAND.md) records assets and generation prompts.
- Added the separately reviewed [capture implementation plan](session-capture-plan.md).
  Runtime recording and model training were not enabled.
