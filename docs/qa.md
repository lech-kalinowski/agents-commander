# QA coverage and validation checklist

This records the source hardening pass started on **2026-09-07**, on top of the
F2/N bulk-launch change, followed by F2/P bulk protocol setup on **2026-09-08**.
The **2026-09-11** protocol replay hardening adds sequence-aware regression
fixtures and the manual redraw acceptance procedure below.
It is not a certification that every possible bug has
been found. These fixes are **included in 0.1.6, not 0.1.5**; a source push is
not an npm release, and publication must be checked separately. Use the branch
and commit under review, not an older global command.
The separate **0.1.7 startup hotfix** below addresses recursive-watch exhaustion
and installed template resolution; it does not relabel the 0.1.6 checkpoints.

## Reproduce the automated checks

Use Node.js 22+, Python 3, and macOS/Linux (WSL2 runs the Linux build):

```bash
npm ci
npm run verify
node dist/bin/agents-commander.js --doctor .
```

`verify` runs typechecking, application unit/integration tests, offline Python
hardware fixtures, development-watch startup/cleanup, the production build,
built-CLI isolation, and a packed-install smoke. The watch check stops only the
processes it owns. The suite uses synthetic tasks, temporary files and local
PTY children, not real provider credentials or private captures. A real terminal
is required for an interactive doctor/manual rehearsal; a non-TTY warning in a
pipe is not a failed interactive runtime test.

Run `npm audit` separately when network access is available. Advisory results
describe the registry state when checked, not a permanent security guarantee.

## Recorded local result

The 2026-09-07 pass on macOS/Node.js 24 completed with **1,118 application tests
across 92 files**, **28 Python hardware tests**, typechecking, build/watch,
production build, built CLI isolation and packed installation all passing.
This adds 60 application regressions above the 1,058-test starting checkpoint.
`npm audit` reported **zero advisories**, including development dependencies,
after a clean installation of the reviewed lockfile.

Pre-change reproductions and post-change reviews covered UI/files, application
lifecycle/configuration, protocol/PTY/adapters, and capture/datasets/hardware.
The [CI workflow](https://github.com/lech-kalinowski/agents-commander/actions/workflows/ci.yml)
repeats the gate on macOS and Linux with Node.js 22 and 24; consult the run for
the exact commit being used instead of carrying this checkpoint forward.

### Bulk protocol checkpoint — 2026-09-08

The F2/P addition passed `npm run verify` on macOS/Node.js 24 with **1,193
application tests across 96 files**, **28 Python hardware tests**, typechecking,
build/watch, production build, built CLI isolation and packed installation.
Pre-change and independent post-change reviews covered session consent,
input-lane races, key rotation, modal ownership and capture boundaries. A
progress-label P-number offset found in review was fixed and regression-tested.

The real Blessed/PTY test launches sixteen local synthetic agents alongside an
unchanged original session, selects only the new agents, verifies default-No
cancellation, then confirms one bulk injection. Every child acknowledges a
complete prompt containing its own key; all sixteen keys differ, hidden panels
receive input, and selection/confirmation keys never reach the child processes.
All test-owned processes terminate afterward. This is transport/UI evidence,
not a live APEX/model-compliance test or physical Codex Micro acceptance.

For manual acceptance, finish login/approvals and leave empty ready CLI prompts.
Use F2 → P, select a subset with Space or A for all unarmed agents, confirm once,
and inspect responses before sending a task. Repeat to verify armed sessions
are disabled/skipped. Esc during progress keeps completed submissions and stops
remaining work after the current paste/submit settles. Do not retry until any
partially failed input has been inspected. Capture must remain off unless it
was explicitly enabled at launch.

### Replay hardening checkpoint — 2026-09-11

The replay hardening passed `npm run verify` on macOS/Node.js 24 with **1,283
application tests across 100 files**, **28 Python hardware tests**, typechecking,
build/watch, production build, built CLI isolation and packed installation.
Independent review covered capability rotation, parser state, replay limits and
echo suppression. Capture/dataset regressions verify sequence preservation,
redaction and compatibility with previously prepared reviews.

Vitest discovery is restricted to `tests/` so ignored, private rehearsal helpers
cannot be executed as part of the public product gate. These counts are software
evidence; physical hardware and live-provider acceptance are separate checks.

A bounded live acceptance on source commit `bbdd7c8` used literal `npm start`
from its normal welcome screen, then two Shell-managed terminals executing real
Pi/APEX sessions. One sequenced SEND and one sequenced REPLY shared one thread.
F12 retained those same two delivered records after F4 fullscreen/back and an
18-second settling period. Both processes stopped cleanly and saved settings
stayed unchanged. This read-only, two-agent run validates that observed exchange,
not every model, terminal, sixteen-agent workflow or physical controller. Its
private media is excluded from the repository and npm package.

### 0.1.7 startup hotfix

The reported unresponsive home-directory launch was reproduced with excessive
recursive filesystem watches and `EMFILE` errors. Node.js 20 is unsupported,
but was not established as the cause: Node.js 22+ and Python 3 remain the runtime
requirements. A separate packaged-runtime bug showed zero templates in Welcome
even though Doctor found all 121; flat `dist` chunks used the wrong asset path,
and launching from the checkout masked it with a working-directory fallback.

Version 0.1.7 replaces recursive traversal with one native, non-recursive handle
per distinct file-panel directory, at most 100. Successful navigation commits
update the watched set; closing or converting panels releases obsolete roots.
Failed roots stop once and are not retried by ordinary status updates. A single
warning per launch explains Ctrl+R manual refresh from a file panel. Successful
watch events do not write logs, preventing feedback even with unnamed native
notifications or a symlink alias of runtime state. Template lookup now uses the
same package-root-aware asset resolver as Doctor and never substitutes cwd files.

The actual packed CLI passed the new keyboard smoke in a temporary, home-like
fixture with **180 nested project directories** and a **128-file-descriptor
limit**. It verified normal Welcome and 121 built-ins, Space, Tab, arrows, F2,
Esc, Ctrl+B, F3, F4/fullscreen-back, F11, F10, live shallow file refresh and a
clean confirmed exit without `EMFILE`/`ENOSPC`. This is PTY/software evidence,
not physical keyboard, provider or Codex Micro acceptance. The fixture is
`tests/built/tui-startup-smoke.mjs`, invoked by the packed-install verification.

Unit/integration regressions additionally cover root deduplication/capacity,
navigation callbacks, watch failures and stale callbacks, no self-log feedback,
source/installed template layouts and rejecting workspace template fallbacks.
Restart after upgrading and repeat the key sequence in the intended terminal.
Do not claim 0.1.7 is published until the registry has been checked; previous
automated test counts above remain historical checkpoints.

### 0.1.8 deep release QA

The local final-source gate passed **1,318 application tests across 104 files**,
**28 Python bridge fixtures**, typechecking, development-watch cleanup,
production build and built/packed CLI checks. A current `npm audit` returned
zero advisories. Consult CI and registry evidence for the exact release; these
counts are not proof of hardware or live-provider acceptance.

Three reproduced races have dedicated regressions:

- A watcher/layout refresh during a slow explicit folder change could reload
  the old path and cancel navigation. Refresh now shares the active navigation;
  newer explicit navigation wins, hidden-file toggles keep the intended target,
  and late reads cannot commit into a destroyed panel.
- A slow Markdown-editor load left the file list focused while a modal was
  active. The loading editor now owns input immediately and accepts Esc/Ctrl+Q;
  a late successful or failed read cannot replace a newer dialog.
- Vim exiting in the background could restore a file panel over an open agent
  picker, leaving the picker visible but unable to receive keys. Panel
  replacement preserves modal focus and updates its return-focus destination.

`tests/integration/deep-keyboard-qa.test.ts` exercises all F1–F12 actions,
dialog resize/cancellation, repeated shortcut bursts, delayed editor reads and
the exact Vim-exit restoration callback. `deep-lifecycle-qa.test.ts` covers
navigation/refresh ordering, filters, failure, destruction and refresh bursts.

The packed gate now also runs `tests/built/tui-stress-smoke.mjs`: 100 panels in
both themes; P100 navigation and fullscreen; 80×24 and 200×60 resizing; closing
P50 without renumbering P100; allocating fresh P101; and default-No quit. A
separate normal launch starts twenty synthetic local Node agents through F2/N,
then uses F2/P to inject into all twenty, including hidden panels. Receipts
verify all children are ready, no automatic protocol was sent, and each receives
one complete explicit injection. Confirmed quit must terminate every child and
leave saved configuration unchanged. No conference/demo mode is used.

### Required gate before another npm publication

1. Reproduce a reported failure before fixing it; add a regression and complete
   independent code review before and after material changes.
2. Run `npm run verify` on the final source, including the packed actual-PTY
   keyboard and stress tests. Run a current dependency advisory check.
3. Require all macOS/Linux, Node 22/24 CI checks on the exact reviewed head.
   Do not treat a source-only test or a passing `--version` as TUI acceptance.
4. Inspect the final tarball, its runtime assets and exclusions; record its
   checksum. Keep presentations, credentials and private capture/dataset rows
   out of both the product commit and the package.
5. Publish only the reviewed candidate, then verify the registry version,
   `latest` tag and integrity against that tarball. Reinstall the public package
   and repeat normal keyboard startup from the intended working directory.

Live model availability, model compliance and physical Codex Micro controls
remain separate acceptance checks. Passing local synthetic transports or the
offline bridge suite is not evidence that those external systems were tested.

## Feature coverage

| Area | Automated evidence |
| --- | --- |
| CLI and packaging | Help/version, doctor, launch-option validation, runtime assets, dataset commands without UI imports, clean packed installation and actual low-descriptor-limit TUI keyboard/template smoke |
| Configuration and adapters | Saved/launch-only precedence, malformed profiles, argument/environment handling, command discovery, OpenCode and synthetic Pi/APEX fixtures |
| Workspace and navigation | Stable IDs, 1–100 panel limits, paging, density, fullscreen/back, cloning, ordering, closing, navigator, real Blessed input and resize |
| Bulk agent launch | 10/16/20 launch logic, 16 independent local PTYs, capacity rejection, unchanged existing sessions, cancellation, startup failures, hidden-panel geometry |
| Bulk protocol setup | F2/P explicit subset/all selection, default-No confirmation, 16 real local PTYs receiving complete distinct-key instructions, no modal-key leakage, hidden stable IDs, stale-session/input-lane races, skip-already-armed, cancellation and shutdown |
| Dialogs and overlays | Enter/Return shielding, keyboard and mouse isolation, cancellation, owner teardown, immediate reopening, focus restoration |
| File browser and editor | Sorting, selection, preview, regular-file/symlink checks, copy/move/delete identity checks, atomic saves, locks and metadata preservation |
| File auto-refresh | Shallow native roots bounded by panel capacity, navigation reconciliation, failed-watch suppression, stale callbacks and no runtime-log feedback |
| Terminal lifecycle | UTF-8/ANSI rendering, PTY resize, restart/replacement, input forwarding, bounded termination and owned-child cleanup |
| Commander Protocol | SEND/REPLY/BROADCAST/STATUS/QUERY, session capabilities, target identity, reply windows, sequence/footer parsing, redraw and resize replay fixtures, chunk boundaries, payload bounds and Activity |
| Demo and templates | Two-agent deterministic offline collaboration, failure/retry cleanup, template catalogue and protocol preparation |
| Capture and datasets | Explicit launch consent, private storage, redaction, crash/incomplete detection, review-gated export, conversational schema, provenance and split isolation |
| Codex Micro | Offline native-bridge parsing, connection epochs, sole-reader ownership guards, decision leases and keyboard fallback behavior |
| Documentation and release | Shortcut/protocol consistency, adapter/template counts, version/license claims, release versus source separation |

Unit tests model edge conditions; integration tests exercise actual Blessed
input and/or local PTYs. Neither is a live-model benchmark. macOS metadata tests
and Linux behavior differ; unsupported platform-specific assertions are skipped
explicitly, not counted as platform validation.

## Confirmed findings addressed

- **Confirmation ownership:** a queued approval could survive owner cancellation,
  and deferred cleanup could remove the shield belonging to a newly opened
  dialog. Cancellation now wins and cannot release a newer modal.
- **Panel navigator:** reopening F11 could immediately close it, and the closing
  Enter/Return pair could reach the previous terminal. Opening/closing dispatch
  is shielded and owner cancellation overrides a queued selection.
- **Information dialogs:** Help and Logs could reopen on their own close
  shortcut, while Enter in Help/Protocol could reach the background terminal.
  The shield now remains active through the complete closing key dispatch.
- **Capture credentials:** quoted keys, spaces/escapes in quoted values, and long
  bare values could leave credentials in recorded content. A bounded scanner
  removes complete recognized values. Existing captures/exports are **not**
  retroactively sanitized; review them again before use. Redaction remains
  best-effort, not a privacy guarantee.
- **Protocol fragmentation:** a long single-line body could acquire artificial
  newlines at PTY chunk boundaries. Buffering preserves real line boundaries and
  fails closed on oversized incomplete input.
- **Protocol limits:** visible-grid and scrollback-tail scanning could bypass
  configured body byte/line limits. All scanning paths enforce the same limits;
  oversized blocks are not routed as truncated payloads.
- **Final terminal output:** complete protocol output immediately before a
  natural process close could be lost before the scheduled scan. Final output
  is reconciled while the closing session is still current; replacement,
  capability and target-session guards remain required.
- **Special-file reads:** preview and editor lock checks could block opening a
  FIFO before checking its type. Nonblocking opens retain regular-file and
  identity checks and do not alter the rejected special file.
- **Startup cancellation:** asynchronous directory initialization could resume
  resource setup after disposal. A disposed application cannot restart, and
  cancelled startup does not install new watchers or input bridges.
- **Theme lookup:** inherited object-property names could resolve to invalid
  themes. Only own theme entries are accepted; other names use Classic Blue.
- **Development dependencies:** patched the test/build dependency graph,
  retaining the runtime dependency ranges and package version. The scoped
  esbuild override is explained in
  [contributor guidance](https://github.com/lech-kalinowski/agents-commander/blob/main/CONTRIBUTING.md).

## Manual acceptance before a presentation or release

1. In the intended terminal, run doctor and resolve runtime/PTY failures. Try
   both themes, resize, switch panels, toggle F4 twice, and cancel dialogs.
2. Run `node dist/bin/agents-commander.js --demo`. Confirm the launch, observe
   both roles, and inspect F12 Activity. Cancel quit once, then quit and confirm
   that Commander restores the terminal.
3. With authorized provider credentials, launch one intended CLI/profile and
   verify authentication/model output. Then try F2 → profile → N → 16 → Enter
   and confirm the actual number of ready sessions. Sixteen means sixteen new
   terminals; existing panels remain. Shared profiles/directories are not
   isolated worktrees or sixteen distinct orchestration roles.
4. Enable protocol in the intended live sessions and exercise a bounded
   SEND/REPLY/BROADCAST/QUERY scenario. ACK means admission/delivery as documented,
   **not** model completion or correctness; inspect per-target Activity.
   Use the current injected sequence format, and complete the redraw checks
   below before treating a recording as a reliable backup.
5. For Codex Micro, follow [the hardware guide](codex-micro.md), including the
   native input checklist, ChatGPT conflict/ownership checks, disconnect/reconnect
   and decision expiry. Keyboard fallback cannot establish device identity.
6. For real training data, separately review rights, privacy, context and quality
   before approving export. Structural validation does not constitute human
   approval or prove that an adapter will train well.

The automated pass does not establish live APEX/provider availability, model
reasoning quality, physical USB/Bluetooth operation, every terminal emulator,
or a successful LoRA training run. No model training, npm publication, controller
firmware flashing or real-data bulk approval is part of this QA workflow.

### Protocol replay acceptance — added in 0.1.6, not 0.1.5

Start the ordinary application with `npm start` from the source checkout after
building. Use synthetic agents first, then an authorized bounded live task; do
not ask a model to execute destructive work just to test replay suppression.
Inject a fresh protocol into each intended running session. New instructions
use a counter starting at 1, incremented across all five verbs with identical
key/number suffixes on the header and END footer.

1. Send one directed message and record the Activity count and route identity.
   Let the message leave the visible viewport, wait longer than the configured
   short deduplication interval, and bring that history back into view. The old
   command must not create another delivery.
2. Toggle F4 fullscreen/back and change terminal dimensions after the exchange.
   Redraw the same sequenced command with different wrapping. Its original
   sequence must still be rejected, with no extra Activity route.
3. Send an intentionally identical new message with the next sequence. It must
   remain a distinct action; reusing an old sequence with a changed body, verb,
   or target must not create another action. Check STATUS/QUERY feedback too,
   because those commands are not stored in Activity.
4. Verify repeated known input/instruction echoes never route. A mismatched
   footer must not complete a sequenced command. Reject zero, leading-zero,
   negative, fractional, non-decimal and unsafe integer sequence forms.
5. With local fixtures, check unseen out-of-order numbers inside the 4,096-number
   window, rejection below the window floor, legacy once-per-session behavior,
   and fail-closed replay-storage saturation with its panel-header warning.
   Verify an actual new process starts fresh and stale-process output remains
   ignored. Explicit fresh-capability injection must reset the counter while
   rejecting old-key output; F2 → P must still skip already-armed sessions.
   Merely resizing must not reset history.

Targeted fixtures are `tests/unit/protocol-sequence.test.ts` and
`tests/unit/terminal-protocol-replay.test.ts`, alongside the existing protocol,
stream-boundary and orchestration tests. Run `npm run verify` for the exact
source revision; previous checkpoint counts above do not certify this change.
Live acceptance additionally requires inspecting actual model output and every
route, not merely a successful recording script exit. Legacy markers without a
sequence cannot disambiguate hard-reflowed text or intentional identical
repeats; document that limitation rather than treating it as exactly-once
delivery. No synthetic pass proves compliance by every CLI or model.
