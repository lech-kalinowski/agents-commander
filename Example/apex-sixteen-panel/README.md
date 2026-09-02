# APEX: sixteen panels, one review council

A source-checkout example with **one APEX coordinator and fifteen APEX
specialists**, each running in its own managed OpenCode terminal. They review
a fictional workshop-booking API, challenge earlier findings, and produce a
release recommendation. They do not modify code or execute tests.

**Status:** example preparation and synthetic routing are testable offline.
Live APEX compatibility is **not verified**: the exact provider/model and
credentials must be supplied and smoke-tested before presenting. “APEX” is a
role label, not proof of model identity. This example does not add a new model
adapter or install a provider. It is not included in the current npm package.

## Roles and handoffs

| Stable panel | Role | Wave |
| --- | --- | ---: |
| P1 | Coordinator and attributed evidence ledger | — |
| P2 | Requirements | 1 |
| P3 | Architecture | 1 |
| P4 | API contract | 1 |
| P5 | Data consistency | 2 |
| P6 | Implementation plan | 2 |
| P7 | Test design | 2 |
| P8 | Security | 3 |
| P9 | Privacy | 3 |
| P10 | Failure and recovery | 3 |
| P11 | Performance | 4 |
| P12 | Observability | 4 |
| P13 | Operator UX | 4 |
| P14 | Skeptical challenge | 5 |
| P15 | Synthesis and release recommendation | 6 |
| P16 | Independent final verification of the evidence | 7 |

P1 sends one task to each specialist. Every specialist replies once to P1;
the coordinator carries the attributed results into the next wave. The normal
successful trace contains **15 SEND + 15 REPLY messages**, across 15 threads.
An input-delivery ACK is not a substantive result or proof of task completion.

There are at most three pending specialist tasks. P1 never uses REPLY;
workers never SEND to one another; nobody uses BROADCAST. This keeps the
protocol's newest-open-reply windows unambiguous. After each completed wave,
the coordinator waits for an explicit human continuation. These are **prompt
instructions**, not a new scheduler or an enforced model-output policy:
watch F12, and interrupt any agent that deviates.

## 1. Prepare without launching anything

Requirements: Node.js 22+, a built source checkout, OpenCode, and an existing
trusted OpenCode config that makes the exact APEX model available. Keep its
credentials in OpenCode's normal authentication/environment setup. Do not
put an API key in `--model` or commit credentials.

Replace the first two values below. The model placeholder is deliberately
rejected until replaced with a real `provider/model` selector. The output
directory must not exist; its parent must already exist.

```bash
npm run build
APEX_MODEL='PROVIDER/EXACT_MODEL_ID'
APEX_CONFIG='/absolute/path/to/existing/opencode.jsonc'
APEX_SHOWCASE='/private/tmp/apex-showcase-16'
node Example/apex-sixteen-panel/prepare.mjs \
  --model "$APEX_MODEL" \
  --opencode-config "$APEX_CONFIG" \
  --out "$APEX_SHOWCASE"
```

The generator checks the provider config's readability but **does not read or
copy its contents**. It creates private files in the new output directory:

- `commander-profiles.json`: sixteen named profile entries, not a complete config.
- `scenario.json` and `brief.txt`: the artificial fixture, roles, and wave plan.
- `start.txt`: one short, single-line coordinator kickoff.
- `continue-wave-2.txt` through `continue-wave-7.txt`: explicit human gates.
- `checklist.txt` and `SETUP.txt`: checks and setup reminders.

No agents, network requests, inference, downloads, or global config writes occur
during preparation. Existing output is never overwritten. An interrupted
preparation leaves its new directory for inspection; choose a fresh path.

## 2. Register the profiles and preflight

1. Back up your existing `~/.agents-commander/config.json`. Merge the sixteen
   entries from the generated `agentProfiles` array into its `agentProfiles`
   array. Preserve every other setting and unrelated profile. If a profile ID
   already exists, review that entry explicitly; do not add duplicate IDs or
   replace the entire config with the fragment. The generator does not perform
   this user-config edit for you.
2. Verify the actual selector in OpenCode before launching sixteen sessions.
   First smoke-test one worker with harmless text and Commander Protocol.
   Check your provider's access, context support, costs, and rate limits.
3. Inspect the effective OpenCode configuration. Each profile sets its role
   through `--agent`, pins the model with `--model`, references the provider
   config through `OPENCODE_CONFIG`, and supplies inline role instructions via
   `OPENCODE_CONFIG_CONTENT`. Both `model` and `small_model` are pinned; only
   the selected provider is enabled in the generated settings.
4. Generated roles request deny-all tool permissions, including file, shell,
   network, and subagent tools. The complete fictional fixture is already in
   each role prompt. Sharing and automatic upgrades are disabled for the run.
   **This is not an OS sandbox or an isolated OpenCode installation.** Config
   layers merge; managed settings, inherited plugins, and environment can alter
   runtime behavior. Use a trusted, rehearsed setup and do not switch models or
   agents during the exercise. OpenCode and the provider can still make normal
   runtime requests and retain conversations.

Configuration fields were checked against OpenCode **1.2.14**, the locally
installed version during preparation. This is a schema/source check, not an
APEX inference test. Recheck behavior when using another version.
[OpenCode configuration](https://opencode.ai/docs/config/#precedence-order),
[agent configuration](https://opencode.ai/docs/agents/),
[1.2.14 config source](https://github.com/anomalyco/opencode/blob/v1.2.14/packages/opencode/src/config/config.ts).

## 3. Open sixteen panels and arm each role

From the source checkout, using the same `APEX_SHOWCASE` value:

```bash
node dist/bin/agents-commander.js --doctor "$APEX_SHOWCASE"
node dist/bin/agents-commander.js --conference --panels 16 --density auto "$APEX_SHOWCASE"
```

Doctor checks the executable and configuration file, not model availability
or inference. Sixteen panels are active, but not necessarily visible at once:
auto density pages them to fit the terminal. Hidden agents continue running.

Start in a **fresh workspace with stable P1–P16**. In each panel, use F2 to
launch the matching `APEX P01 …` through `APEX P16 …` profile. Complete any
authentication before presenting. Press **Ctrl+P separately in all sixteen
running sessions**, giving each its own current protocol capability. Do not
type `opencode` into an unmanaged shell and expect the same managed lifecycle.

Check F11 for all intended roles and stable P IDs. F4 focuses one terminal and
returns to the grid; F7 changes position without changing its P address.
**Do not use F6 to populate the roles:** it clones the same configured role,
not the next specialist. Do not remove/recreate panels mid-run; replacement
sessions need fresh protocol bootstrap, and new panels may have different IDs.
Codex Micro can use its already-configured navigation; no hardware remap is
required by this example.

## 4. Conduct the collaboration

Only after verifying all sixteen sessions, open **Ctrl+O**, select the existing
coordinator profile, target **P1**, and paste the single line from `start.txt`
as the task. Do not select a different profile or approve replacing P1.

Watch the first three SEND/REPLY exchanges in F12. Check the actual result
content, thread links, and contributor IDs—not just green delivery states.
After all three results are consolidated, use Ctrl+O with that same coordinator
and P1 to send `CONTINUE APEX WAVE 2`. Continue with the matching generated
single-line command for waves 3–7. Do not send a continuation early or skip a
wave. P14 challenges the accumulated findings, P15 synthesizes them, and P16
checks that final recommendation against the supplied evidence.

Use `checklist.txt` to assess the final result. A correct-looking protocol
frame is not evidence that a recommendation is correct. No tool or model is
permitted to claim that proposed code changes or tests were executed.

## Timing, interruption, and recovery

This is an **extended/rehearsal showcase**, not a promise that seven dependent
inference stages fit the presentation's five-minute live-demo segment. Rehearse
the exact provider/model first. For a short on-stage demonstration, prestart all
panels, show one or two waves within the existing segment, and label the result
as partial. A prepared full-run outcome must be labelled as prepared.

- Agree a per-wave wait ceiling before the run (for example, 45 seconds once
  tasks are delivered), and keep the presentation's existing segment hard stop.
  These are human time limits, not automatic cancellation timers.
- If any worker stalls, fails, misroutes, or ignores its role, inspect F12 once,
  withhold the next continuation, and report partial results. Do not invent a
  response, silently substitute a model, or launch retries on stage.
- `STOP APEX SHOWCASE` to P1 is a cooperative prompt, not a kill switch. Use
  Ctrl+K on the selected running session or F9's confirmed close when necessary;
  F10 quits Commander and shuts down its tracked agent processes.
- Rehearse any reset in a new, correctly mapped workspace. Do not repair a
  running demonstration by renumbering roles or sharing capability keys.

## Optional capture and dataset use

Recording remains off unless explicitly requested at launch. Follow
[the dataset guide](../../docs/datasets.md) for capture flags and private output
locations. Use Ctrl+O for kickoff/continuations so Commander can observe those
inputs. Do not use `--demo` here: that launches the separate two-agent scripted
offline demonstration, not APEX.

The fixture is artificial even when responses come from a real model. Preserve
that provenance separately; do not describe it as production communication.
Current captures identify the adapter, not verified APEX model identity, and
do not capture all OpenCode system/role configuration. Keep the generated
scenario/profile evidence privately for review. Approve context only if it is
sufficient; preparation does not make a capture training-ready. Quality,
privacy, rights, and explicit export review gates still apply. No training,
automatic approval, or dataset upload is part of this example.
