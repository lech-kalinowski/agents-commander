# Changelog

## 0.1.8

### Fixed

- Break obsolete soft-wrap links when a TUI erases an entire terminal row.
  A freshly painted Commander header is no longer joined to unrelated old
  text, which could delay routing until another redraw or panel resize.
  Preserve genuine wraps, partial edits, capability checks and replay guards.
- Keep automatic file refresh from superseding an in-flight explicit directory
  navigation. Later navigation still wins; hidden-file toggles follow the
  intended destination, and closed panels cannot commit late reads.
- Own keyboard focus immediately while the Markdown editor loads a file.
  Esc/Ctrl+Q can cancel a slow load, and its late result cannot reopen the
  editor or steal focus from a newer dialog.
- Preserve dialog focus when a background Vim process exits and its terminal
  becomes a file panel. Dismissing the dialog returns to the new file list,
  not the destroyed terminal.

### Release QA

- Add real Blessed regressions for all F1–F12 controls, delayed file reads,
  modal lifecycle, refresh bursts and background panel replacement.
- Extend the mandatory packed-install gate with 100-panel navigation/resize
  checks in both themes, stable P IDs after close/add, and twenty local PTYs
  receiving explicit bulk protocol setup, default-No quit and child cleanup.
  These are synthetic local fixtures, not live-provider or hardware acceptance.
- Runtime support remains Node.js 22+, Python 3 and macOS/Linux/WSL2. Restart
  existing Commander processes after upgrading.

This section describes version contents; verify npm publication separately.

## 0.1.7

### Fixed

- Prevent recursive watching of a home/project tree from exhausting file
  descriptors and making startup input unresponsive. Watch only distinct
  file-panel directories with shallow native handles, capped at 100; reconcile
  subscriptions when panels navigate, close, or become terminals.
- Stop failed watches without automatic retry storms and show one warning per
  launch with Ctrl+R manual-refresh guidance. Do not log successful file events,
  avoiding feedback through runtime logs or symlink aliases.
- Resolve built-in templates from the executing package layout, including flat
  `dist` chunks. Installed launches no longer report zero templates or substitute
  workspace-controlled files when the package library is missing.

### Tests and upgrade

- Add actual packed-CLI keyboard and template checks in a synthetic home-like
  directory containing 180 nested project directories, under a 128-descriptor
  limit. Verify normal Welcome, panel/dialog keys, Ctrl+B, live file refresh and
  clean keyboard-driven exit; no providers or physical hardware are launched.
- Node.js 22+ and Python 3 remain required. Node.js 20 is unsupported but was not
  established as the cause of the reproduced watcher freeze. Restart Commander
  after upgrading. The 0.1.6 collaboration and dataset behavior is unchanged.

This section describes version contents; verify npm publication separately.

## 0.1.6

### Added

- Protocol sequence suffixes on all five command headers and their
  END footer. Newly injected instructions use one increasing per-capability
  counter, allowing intentional identical actions without treating old terminal
  history as new output. Capability-only markers remain compatible.
- Explicit F2/P bulk protocol setup for selected or all running agent profiles,
  including hidden panels. One confirmation precedes sequential submissions;
  each session gets a private key. Already-enabled sessions are skipped and
  exact-session checks prevent injection into replacements. Esc stops remaining
  work after any started paste/submit settles. No automatic task or recording.
- F2 batch launch: select one CLI/profile, press N, and choose
  how many new terminal panels to create at the selected panel's directory.
  One confirmation precedes sequential launches; Esc stops the remaining work
  while preserving already-started sessions and existing panels.
- Batch launches use distinct Commander session IDs and the selected profile's
  unchanged arguments/environment. They do not create worktrees, assign
  different roles, bootstrap the protocol, submit tasks, or enable capture.
- Capture and reviewed dataset export preserve the optional wire message counter
  separately from capture-event numbering. Previously prepared legacy reviews
  remain supported without fabricating counters or upgrading old completions.

### Fixed

- Keep bounded, process-session replay protection across terminal redraws,
  scrollback scans and fullscreen/resize changes instead of allowing old frames
  to route again after the short deduplication interval. Sequenced frames retain
  their identity even when a CLI changes hard line wrapping. Repeated recognized
  input echoes remain suppressed. Legacy identical frames are conservative
  once-per-armed-session; ambiguous hard-reflow cases require sequenced output.
  Exhausting replay storage fails closed with a panel-header warning and
  requires an agent restart or explicit fresh-capability injection; this is not
  an exactly-once delivery guarantee.
- Preserve confirmation ownership across cancellation and immediate reopening;
  an owner-cancelled dialog cannot commit a queued approval or release a newer
  dialog's input shield.
- Keep repeated F11 navigator opens usable and prevent the selection's
  Enter/Return pair from reaching the previously focused terminal.
- Keep Help/Logs close shortcuts from reopening their dialogs, and shield the
  closing Enter/Return pair in Help and the protocol guide.
- Redact complete recognized credential assignments, including quoted JSON keys,
  spaces/escapes and long values, before capture persistence. Existing captures
  and exports are not retroactively sanitized; human review is still required.
- Preserve long protocol body lines across fragmented PTY output with bounded,
  incremental buffering; enforce configured byte/line limits in visible-grid
  and scrollback-tail scans too. Scan complete final output on natural process close
  without reviving exited-source ACK/reply windows or weakening target guards.
- Reject named pipes and other nonregular preview/editor inputs without a
  blocking open, retaining symlink and filesystem identity checks.
- Prevent asynchronous startup from installing resources after disposal, and
  safely fall back for unknown/inherited theme-property names.
- Keep panels created during a modal operation behind the dialog and its
  registered mouse shield, preventing background file selection or focus
  changes while a batch launch is awaiting directory loading.

### Maintenance

- Restrict application test discovery to `tests/`, excluding private rehearsal
  helpers and other non-product scripts from the public verification gate.
- Update development test/build dependencies to patched versions while retaining
  runtime dependency ranges.
- Add build/watch startup and owned-process cleanup to the verification gate,
  plus a QA coverage and manual acceptance guide.

These changes are new in 0.1.6 and are not included in npm 0.1.5. Node.js 22+
and Python 3 remain required. Restart existing sessions and inject fresh protocol
instructions to use sequenced replay protection. Provider usage and configured
startup/resume behavior still apply. Presentations, private recordings and
training datasets are excluded from the package.

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
