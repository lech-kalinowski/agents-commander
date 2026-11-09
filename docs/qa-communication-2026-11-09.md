# Communication repair QA - November 9, 2026

The later rendering/scrollback follow-up below supersedes the initial
feedback-only local installation described in this report.

## Reproduced failures and changes

The installed npm 0.1.12 package was exercised with real Claude in P1 and
Codex in P2. Short and multiline messages routed in both directions, but
Claude's ACK remained in its input composer after the controller wrote text
and Enter together. A successful PTY write had been mistaken for successful
submission by the CLI. The first addressed SEND could also be silently
discarded by the startup-autonomy heuristic, as seen in the user's runtime log.

The repair in `src/orchestration/orchestrator.ts`:

- Separates short Claude feedback text from Enter by the existing 120 ms
  direct-input delay. Other adapters now separate pasted feedback from Enter
  using their normal submission path.
- Holds the same session input lane through that submission, preventing the
  next task from being pasted ahead of feedback's Enter. Delayed submission
  retains exact-session, shutdown and correction guards.
- Accepts explicitly addressed authenticated SENDs immediately after setup.
  Capability authentication, exact adapter/panel matching, replay guards and
  suppression of unsolicited startup broadcasts/status remain in place.

The patch does not add automatic Enter retries, permission approvals, guessed
addresses, key repair or replay execution. A delivery ACK still describes
Commander input delivery, not guaranteed completion of a model's work.

## Automated validation

The full `npm run verify` gate passed under Node 22.23.2:

- 1,867 application tests in 123 files, including five new regression cases.
- 37 Python tests.
- Type checking, development-watch smoke, production build and installed CLI.
- Packed keyboard/navigation checks, both 100-panel layouts and twenty
  synthetic PTY sessions with cleanup.

New regressions cover the authenticated first P2-to-P1 SEND, delayed feedback
submission, input-lane ordering, and replacement-session cancellation. Existing
capture and correction tests now account for separate text and Enter events.

## Live installed-package validation

The exact local archive was installed in an isolated npm consumer directory.
`tests/live/claude-codex-communication.mjs` passed its complete opt-in matrix:

- Short P2-to-P1 SEND and P1-to-P2 REPLY.
- A multiline SEND containing every one of 32 padding lines, followed by REPLY.
- QUERY ping and an agent response after the controller's PONG.
- STATUS and an agent response after its ACK.
- BROADCAST and a recipient-produced receipt marker.

The successful run had exactly five delivered ledger messages; QUERY and STATUS
are local controller operations. Both Claude ACK drafts cleared without rescue
Enter or resize. Both owned sessions stopped after the run. The harness logs
bounded metadata, not terminal transcripts or capability keys. It uses real
TerminalPanel/AgentManager/Orchestrator instances and provider CLIs; packaged
keyboard/UI coverage is supplied by the separate automated gate.

The tested CLIs were Claude Code 2.1.319 and Codex 0.167.0. During a preliminary
probe, Codex's startup update menu ran its offered update from 0.154.0. The
retained harness disables that update screen using a per-launch option. No
Commander configuration was changed and capture remained off.

### Limits observed during repeated attempts

One early harness startup selected the temporary-directory trust option before
the screen was settled. The retained harness waits for the complete trust
screen. Another attempt had Codex omit padding; the prompt was clarified and
the complete-content assertion retained.

Additional attempts did not pass the entire matrix. Scoped inspection of the
harness-owned Codex histories established two model-compliance errors: a
BROADCAST footer with a mistyped capability and a QUERY repeated with an already
used counter after the controller's PONG was received. These frames remained
rejected. No generated repair was substituted to make those runs pass.

Therefore the evidence supports the two application fixes and a complete live
pass, not universal or repeatable success for every model-generated frame.
Malformed frames or reused counters can still stop an agent workflow. The
full sixteen-agent OpenCode/APEX release gate and physical hardware acceptance
were not rerun for this targeted repair.

## Local installation

Verified archive: `agents-commander-0.1.12.tgz`, SHA-256:

```text
b3b23c32ae4528466fc6727027a9c346cbb4741535a08e529b40d9a6c78b8586
```

The archive, metadata-only live reports and backups of the previous global
installations are under `/tmp/commander-communication-fix/` on the test machine.
The same archive replaced the existing global package in the Node 20.20.0 and
Node 22.23.2 prefixes. All 142 installed runtime files in each location matched
the isolated tested package byte for byte. The installed CLI version command
passed under Node 22.23.2, and no QA probe controllers remained running.

This is a local patched 0.1.12 installation, not a new npm registry publication.
The package version is unchanged. A registry reinstall can overwrite the local
patch. Use supported Node 22+ and restart Commander and its agent sessions;
explicitly inject protocol into each ready agent with Ctrl+P.

## Follow-up: repeated stalls and redraw glitches

The subsequent screenshot and expanded QA exposed separate terminal problems,
not a reason to relax authentication or blindly retry Enter:

- CSI REP ignored a preceding SPACE. Shortened repaints could leave stale text
  attached to a footer. REP now retains the last printed graphic independently
  of cursor position and resets that state on terminal reset.
- The virtual terminal treated broad dingbat ranges as wide, including narrow
  Claude spinner/bullet symbols. Default emoji and explicit emoji presentation
  now share a width predicate, with split variation-selector and narrow-panel
  handling.
- Blessed's own older width tables treated modern emoji as narrow. A real
  Blessed-to-terminal test replaced an emoji-containing `Pong!` with `Done`
  and reproduced a leftover exclamation mark. The compatibility layer fixes
  both cell allocation and incremental painting; dependency files are untouched.
- Top-anchored scroll regions with a fixed composer discarded their scrolled
  rows instead of retaining primary-buffer history. Codex's valid long frame
  lost its header before END arrived. The revised scrollback path preserves
  that history, while internal regions and alternate buffers remain excluded.
  IND/NEL also use region-aware scrolling. This matches the top-margin
  distinction in the [xterm.js buffer implementation](https://github.com/xtermjs/xterm.js/blob/master/src/common/services/BufferService.ts).

Two live stacked-layout attempts before the scrollback fix passed the short
exchanges but stalled on the 32-line payload. The second also passed the
six-delivery continuing REPLY chain. Scoped inspection of the first attempt's
QA-owned Codex history confirmed all padding lines, the current capability and
matching counter/footer. Diagnostic metadata in the second attempt showed
zero retained Codex scrollback and only the final END on screen.

The combined repair subsequently passed the complete stacked-layout matrix,
including that long message and the continuing REPLY chain: 15 deliveries,
all delivered, no rescue Enter or resize, and both owned sessions stopped.
Metadata confirmed Codex used both top-anchored and internal scroll regions.
No CSI REP commands were observed in that live pass; REP correctness is backed
by deterministic regression tests, not a claim that this CLI run exercised it.

The final source gate passed `npm run verify`: 1,897 application tests in 124
files, 37 Python tests, type checking, dev-watch, production build, built CLI,
packed keyboard checks, both 100-panel layouts and twenty synthetic PTYs.
Thirty new tests cover this follow-up, including all five long protocol command
kinds, exact payloads, replay suppression and emitted Blessed redraw output.

Final local archive under `/tmp/commander-redraw-fix/verified/`, SHA-256:

```text
8cf988ab6aacc988b469ea20a5ba989d9e95c7c86c9910553c85ec38a64c115b
```

That exact archive passed the full live matrix again in both the 212-by-66
stacked layout and the 200-by-55 side-by-side layout: 15 delivered records per
run, 30 total, with all eight checks passed and both sessions stopped in each
run. QUERY/STATUS are controller operations and are not included in that
delivery count. There were no rescue Enters, duplicate records or remaining
Claude ACK drafts. The metadata-only logs are `verified/live-stacked.log` and
`verified/live-side-by-side.log` under the directory above.

The archive replaced the global copies in both the Node 22.23.2 and Node
20.20.0 prefixes. All 153 packaged files, including 142 runtime files, matched
the isolated tested package byte for byte in both locations. The Node 22 CLI
reported version 0.1.12. Backups of both previous installations are alongside
the archive, and no live QA controller/helper processes remained. Node 20 is
still unsupported; this update does not change Node itself. Restart Commander
under Node 22+ and explicitly arm protocol in each ready agent. Existing
processes do not hot-reload the installed replacement.

This remains a local patched 0.1.12, not a registry release. These targeted
checks do not establish universal model compliance, complete Unicode grapheme
support, the sixteen-agent release acceptance gate or physical hardware QA.
