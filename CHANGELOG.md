# Changelog

## Unreleased

### Added

- Source-checkout F2 batch launch: select one CLI/profile, press N, and choose
  how many new terminal panels to create at the selected panel's directory.
  One confirmation precedes sequential launches; Esc stops the remaining work
  while preserving already-started sessions and existing panels.
- Batch launches use distinct Commander session IDs and the selected profile's
  unchanged arguments/environment. They do not create worktrees, assign
  different roles, bootstrap the protocol, submit tasks, or enable capture.

### Fixed

- Keep panels created during a modal operation behind the dialog and its
  registered mouse shield, preventing background file selection or focus
  changes while a batch launch is awaiting directory loading.

This workflow is not included in the npm 0.1.5 package. Provider usage and
configured startup/resume behavior still apply.

## 0.1.5

### Added

- Adaptive workspace for up to 100 stable panel IDs, with paging and readable
  visible density. Hidden agent sessions keep running.
- Panel-first function keys: fullscreen/restore, fresh-session cloning,
  reordering, closing, and a searchable panel navigator.
- OpenCode support and named model/agent profiles.
- Routed-message Activity and a protocol guide with session-bound capabilities.
- Startup diagnostics and a deterministic offline collaboration demo.
- Experimental, opt-in Codex Micro input with guarded decision controls.
- Private, opt-in semantic capture and human-reviewed LoRA/SFT dataset export.
- Contributor guidance, issue templates, and macOS/Linux verification on
  Node.js 22 and 24.

### Changed

- The project now uses the MIT License. Earlier packages retain their bundled
  license; third-party notices remain intact.
- Node.js 22+ and Python 3 are required. Supported platforms are macOS, Linux,
  and WSL2.
- Conference material is maintained separately under `talks/` and excluded from
  npm. Pi/APEX collaboration examples remain source-checkout examples.

### Fixed

- Terminal rendering, resize handling, PTY lifecycle, packaging, and shutdown.
- File/editor safety and confirmation-dialog focus and key handling.
- Routing/session isolation and guarded hardware-input conflicts.
- A logger rotation-lock race that could disable logging after another process
  released its lock; retry paths keep the existing bounded wait.

### Scope

Dataset export does not download models or train an adapter. Full terminal
transcripts and replay are not included. Offline fixtures do not establish
live-model reasoning quality or a successful sixteen-agent APEX run.

## 0.1.4 and earlier

These releases predate the workspace, diagnostics, hardware, and dataset
features above. Check the license and requirements included with each version.
