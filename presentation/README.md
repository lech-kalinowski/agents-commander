# Code Europe conference session

`Agents_Commander_Protocol.pptx` is the canonical 45-minute Code Europe deck.
It includes presenter notes, recovery cues, and source references for technical
claims.

Published session topic:
[No Framework, No Server: Making AI Agents Collaborate in One Terminal](https://codeeurope.pl/speakers).
The deck follows the public promise: multiple CLI agents working side by side,
local collaboration through observed terminal output and injected terminal
input, visible challenge and refinement, and practical human control without a
central orchestration server or heavyweight agent framework.

The previous Keynote export and Python generators were removed because they had
drifted from the product. They described an older release and could recreate
claims that are no longer accurate. Update the canonical PowerPoint directly.
The current technical rewrite replaces feature-card content with architecture,
protocol, sequence, and state diagrams plus genuine application captures,
while retaining the Callstack visual identity. Its revised slide order follows
the session shape below. Render and inspect every slide before committing it.

The title, npm-package, Agent Conf invitation and closing slides use the
classic-blue Agents Commander pixel `>/<` mark from `assets/logo.png`: cyan
chevrons and a yellow slash on an opaque blue background. Keep it aligned with
the README and landing page; preserve its square aspect ratio and clear space.
The matching promotional
wordmark is `assets/logo-wordmark.png`. The authentic Callstack logo and visual
identity remain unchanged. Asset provenance and generation prompts are in
[the brand guide](../assets/BRAND.md).
The closing sequence now includes the implemented dataset architecture, the
protocol-learning roadmap and an Agent Conf invitation, using the same
inherited Callstack layouts and typography.

## Session shape

| Slide | Segment | Time |
| --- | --- | ---: |
| 1 | Published title and terminal-native collaboration thesis | 1 minute |
| 2 | Genuine Agents Commander UI capture | 1.5 minutes |
| 3 | Local process, PTY, CLI, and provider architecture | 2.5 minutes |
| 4 | Terminal observation and delivery pipeline | 1.5 minutes |
| 5 | Annotated session-bound protocol frame | 3 minutes |
| 6 | Streaming parser states | 2 minutes |
| 7 | Five protocol verbs as a routing graph | 1.5 minutes |
| 8 | `SEND` / delivery ACK / `REPLY` sequence | 3 minutes |
| 9 | Session identity and pending reply windows | 2 minutes |
| 10 | Bounded routing guards and limitations | 2 minutes |
| 11 | Commercial landscape: BAND / Jam comparison | 1.5 minutes |
| 12 | Scripted offline transport proof | 4 minutes |
| 13 | Real-agent challenge/refinement branch | 6 minutes |
| 14 | Genuine `F12` Activity capture | 1.5 minutes |
| 15 | Human and optional hardware control | 1.5 minutes |
| 16 | Failure and recovery decision tree | 1.5 minutes |
| 17 | Public npm package and conference-source distinction | 1 minute |
| 18 | Implemented capture and reviewed dataset architecture | 1.5 minutes |
| 19 | Future: teaching models the Commander Protocol | 1 minute |
| 20 | Agent Conf invitation | 0.5 minutes |
| 21 | Questions | 5 minutes |
| | **Total** | **45 minutes** |

## Implemented dataset architecture

Slide 18 traces the implemented pipeline, separate from the training roadmap:

1. **Observe semantic events.** With explicit `--capture protocol` consent,
   Commander records its own submitted inputs, accepted protocol frames and
   routing outcomes. It does not record raw keystrokes, provider prompts,
   hidden reasoning or internal tool calls.
2. **Seal private storage.** Best-effort redaction replaces known capabilities
   and credential patterns before local JSONL writes. Bounded segments and a
   SHA-256 manifest support strict integrity checks; incomplete captures are
   not training sources. File permissions are not encryption, and redaction
   does not guarantee privacy.
3. **Prepare and group candidates.** `dataset prepare` verifies complete
   captures and constructs one focal agent's next response with its previously
   observed context. Unknown/manual input excludes later candidates for that
   session. Project-family and detected near-duplicate groups receive frozen
   split assignments before review; fewer than three independent groups means
   train-only data, not a held-out evaluation.
4. **Require human review.** Candidates start unapproved. Hash-bound decisions
   must confirm quality, sufficient context, privacy and training rights, with
   an identified reviewer and timestamp. Successful delivery alone proves none
   of those properties.
5. **Export and validate.** `dataset export` emits approved conversational
   `prompt` / `completion` JSONL with synthetic, format-valid capability keys.
   Real and synthetic train/validation/test files remain separate. Provenance
   stays in private sidecars; `dataset validate` checks hashes, review bindings,
   split isolation and complete protocol frames.

Integration tests exercise the actual parser, routing, recorder and dataset
pipeline with synthetic terminal endpoints. This is pipeline evidence, not a
permissioned real-data pilot or proof that a trained model collaborates well.
No model has been selected, tokenized, trained or evaluated by this feature.
See the [dataset guide](../docs/datasets.md) and
[implementation review](../docs/dataset-implementation-review.md).

## Protocol-learning roadmap

Slide 19 connects real, permissioned agent communication to reviewed datasets,
model-specific LoRA adapters and held-out protocol evaluation. Opt-in capture
and reviewed JSONL export are implemented in the conference source. Model
selection, tokenization, fine-tuning and model-quality evaluation remain future
work; no trained adapter or generalization result is claimed.

The ambition is broad model interoperability: portable training data, with a
separate adapter for each compatible, trainable base model. Do not describe it
as one adapter for every LLM, including closed models without weight access.
Frame validity, routing behavior and useful collaboration must be measured
against the prompted base model on unseen project groups. Runtime authorization
and routing guards remain necessary after training.

See the [dataset guide](../docs/datasets.md),
[TRL SFTTrainer](https://huggingface.co/docs/trl/sft_trainer) and
[PEFT checkpoint guidance](https://huggingface.co/docs/peft/developer_guides/checkpoint).

## Agent Conf promotion

Slide 20 invites the audience to [Agent Conf](https://www.agent.sh/),
**17–18 September 2026 in Warsaw**, at **Crowne Plaza Warsaw [The HUB]**.
The call to action is [agent.sh/tickets](https://www.agent.sh/tickets).
The [Callstack event listing](https://www.callstack.com/events/agent-conf)
confirms the organizer, dates and city. Details were checked on **2026-09-02**;
recheck before presenting. No ticket price, discount or additional speaking
commitment is promised on this slide.

The roadmap and invitation take 90 seconds together, funded by 30-second
reductions to the UI overview, commercial comparison and recovery segment.
The new 90-second dataset architecture segment is funded by 30-second
reductions to the process architecture, terminal pipeline and protocol-verb
segments. The full session remains 45 minutes, without shortening either demo
or the five-minute Q&A.

## Commercial landscape

Slide 11 compares Commander with [BAND / Jam](https://www.band.ai/use-cases/jam)
using vendor documentation, not a hands-on benchmark. Jam is the closer coding
workspace comparison; BAND is the broader commercial collaboration platform.
[Jam's documented architecture](https://docs.band.ai/jam) combines Desktop,
a bundled CLI, the `jamd` daemon, and a Claude Code plugin. Coding sessions
remain local while coordination messages travel through BAND rooms.
Commander instead routes observed terminal output into local target PTYs.

[BAND platform pricing](https://www.band.ai/pricing), checked on **2026-09-02**,
lists Free, Pro at **$17.99/month**, and Enterprise by quotation. Separate
Jam-specific billing was not verified. Recheck pricing before presenting;
do not portray BAND as paid-only, claim every BAND adapter works directly in
Jam, or treat vendor security/reliability claims as independently tested.

## Public package versus conference source

The public [npm package](https://www.npmjs.com/package/agents-commander) has
`latest` version **0.1.4**, verified on **2026-09-02**. To try that published
release:

Use Node.js 22 or newer. The 0.1.4 package's `engines` field says `>=18`, but
its dependencies require a newer runtime.

```bash
npx agents-commander@0.1.4 .
```

The conference deck and rehearsal commands below describe **0.1.5 from this
source checkout**, on the
[`codex/review-and-release-0.1.5` branch](https://github.com/lech-kalinowski/agents-commander/tree/codex/review-and-release-0.1.5),
using Node.js 22 or newer and Python 3. Do not attach
`--doctor`, `--demo`, or `--conference` to the 0.1.4 public-package command;
those presentation flows are demonstrated from the built conference source.

The [source is available on GitHub](https://github.com/lech-kalinowski/agents-commander)
under **CC-BY-NC-4.0**. Public availability does not imply an OSI-approved
open-source license or unrestricted commercial use.

## Demo preflight

Use Node.js 22 or newer and Python 3.

```bash
nvm install
nvm use
npm ci
npm run verify
node dist/bin/agents-commander.js --doctor .
```

Start the presentation-safe experience:

```bash
node dist/bin/agents-commander.js --conference .
```

Keep the fully offline path ready in a second terminal:

```bash
node dist/bin/agents-commander.js --demo
```

The offline demo seeds two bundled local demo roles and a deterministic routed
handoff. These roles are scripted transport fixtures, not LLM reasoning. The
proof requires no network access, API key, or external agent CLI and shows the
complete `SEND` to local `STATUS` to `REPLY` sequence with visible
acknowledgement and provenance. `STATUS` is observed locally and does not
route. The on-screen role names remain `Demo Coordinator` and `Demo Reviewer`;
both are deterministic transport fixtures.

### Primary real-agent branch

Use exactly two authenticated real CLI sessions and one read-only repository
task:

```bash
node dist/bin/agents-commander.js --conference --panels 2 .
```

- Panel 1: Codex CLI.
- Panel 2: Claude Code.
- File under review: `src/orchestration/message-ledger.ts`.
- Before the audience enters: start both CLIs, finish authentication, press
  `Ctrl+P` in both panels, and verify that `F12` opens.

Type this exact prompt in panel 1:

> Read `src/orchestration/message-ledger.ts`. Do not edit files. In at most five
> bullets, propose a minimal opt-in design that persists routed Activity across
> restarts. Say whether message content is stored and name one security
> assumption. End the proposal with `PROPOSAL_READY`. Then use Commander `SEND`
> to Claude Code in panel 2 with this exact request: Challenge the assumption
> that full message content should be persisted. Cite two concrete controls
> already present in `message-ledger.ts`, give one testable acceptance criterion,
> end with `CHALLENGE_READY`, and `REPLY` to me. When the challenge returns,
> refine or reject your proposal with evidence from the file, name one test, and
> end with `REFINED_READY`.

Expect the challenge to identify that durable full-content storage may retain
sensitive prompts and bypass the current bounded in-memory design. It should
cite `maxMessages` plus the content-byte limits or truncation behavior. The
refinement should keep persistence opt-in, default to metadata-only or redacted
content, rotate within a bound, and name a test.

The branch succeeds when panel 2 challenges through a routed reply, panel 1
reaches `REFINED_READY`, and `F12` shows delivered `SEND` and `REPLY` records on
the same thread with the expected source and target. Allow 45 seconds per agent
response. On timeout, authentication failure, provider failure, or routing
error, open `F12` once, name the visible failure, stop waiting, and narrate the
prepared challenge/refinement from slide 13. Do not debug credentials on stage.
Never present the scripted offline roles as reasoning agents.

For the optional experimental Codex Micro segment, allow the presentation
terminal under macOS Input Monitoring. Fully quit ChatGPT Desktop first, or
disable ChatGPT's Input Monitoring permission and restart it while leaving the
presentation terminal permitted. Never use `sudo`. Then verify the native
device probe and complete the physical-control checklist before opening the
audience-facing run:

```bash
node dist/bin/agents-commander.js --doctor --codex-micro .
node dist/bin/agents-commander.js --codex-micro-test .
node dist/bin/agents-commander.js --conference --panels 12 --density auto --codex-micro .
```

Conference and Demo modes do not enable the controller automatically. Prefer a
wired USB-C connection on stage and keep a normal keyboard ready. `MICRO:BUSY`
means another active HID event reader was detected; Commander fails closed and
discards its device input. This sole-reader check is not an OS-enforced
exclusive lock. On the tested firmware 0.4.1, switching to Layer 2 did not
isolate the shared vendor events. Native input can verify the exact device and
read safe status metadata; it does not read serial numbers, update firmware,
or control RGB lighting.
Guarded Approve and Reject controls remain off unless
`--codex-micro-decisions` is added. Physical labels describe the factory
arrangement and the keycaps are swappable. See [the Codex Micro rehearsal
guide](../docs/codex-micro.md) for the fixed switch-position mapping, keyboard
fallback, and rehearsal.

## On-stage recovery

- `F12` opens routed activity; `Shift+F12` opens the protocol guide.
- When no demo role remains live, `Ctrl+O` can offer a fresh seeded demo. While
  either role is live it opens normal Orchestrate; relaunch `--demo` for a clean
  reset.
- Press `Tab` to focus a file panel, then `Ctrl+E` returns to a two-panel
  baseline after confirming any live sessions. A running terminal receives the
  key instead of resetting the layout.
- `Ctrl+K` stops the active session. `F10` escalates tracked process groups from
  `SIGINT` to `SIGTERM` to `SIGKILL`, waits for their termination, and then
  restores the terminal.
- If any external agent or conference network is unreliable, switch to
  `--demo` and continue with the same protocol story.
- If `MICRO:BUSY` appears, do not keep pressing controls. Quit the competing
  HID client and wait for `MICRO:USB/GUARD` to return. Restart Commander only
  if guarded status does not recover; otherwise continue with a conventional
  keyboard. No agent session depends on the device.
- If the legacy keyboard fallback is used, keep ChatGPT fully quit for the
  entire session; that mode has no reader guard and disables decisions.

## Deck quality checks

Before replacing the committed PowerPoint:

1. Render the exported `.pptx`, not only the editor preview.
2. Inspect all 21 slides at presentation resolution.
3. Check for slide-canvas overflow and unintended overlaps.
4. Confirm the speaker notes still total 45 minutes and retain recovery cues.
5. Run `npm run verify` so the commands and product claims in the deck remain
   aligned with the release.
