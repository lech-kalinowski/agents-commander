# APEX through the Pi harness

This guide prepares the sixteen-panel review council for Pi. Each role has a named
Commander profile, an isolated Pi configuration and its own managed terminal.
The shared [roles and seven-wave runbook](README.md#roles-and-handoffs) still apply.
Pi profiles use the existing `generic` Commander protocol adapter, so routed
messages address `generic:Pn`. Select **APEX Pi P01 … P16** in F2 and Ctrl+O.

Verified on 2026-09-05: authenticated model discovery, a Pi `APEX_PI_READY`
response, and two real Commander PTY sessions completing Ctrl+P bootstrap and
one SEND/REPLY round trip on the same thread. The sixteen-panel routing graph
also passes synthetic tests. The full sixteen-role live review still needs rehearsal.

## Prepare and register

Use Node.js **22.19+**. Pi is an optional harness installed separately from
Commander. This example was checked with `@earendil-works/pi-coding-agent@0.85.1`.
The scripts run from a source checkout and are not shipped in the npm package.

Create a private `apex_api` file containing your API key on one line and HTTPS
base URL on another. This file is ignored by git. The launcher reads it as data;
it never sources it as shell code. Apply `chmod 600 apex_api` after creating it.

Close Commander before registering profiles, then restart it after registration.
An already-running instance can save its old in-memory configuration over the
new entries. From the repository root:

```bash
npm install --prefix .commander-local/pi-runtime --ignore-scripts --no-audit --no-fund \
  --save-exact @earendil-works/pi-coding-agent@0.85.1

APEX_SHOWCASE="$PWD/.commander-local/apex-pi-demo"
APEX_PI_ENTRY="$PWD/.commander-local/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"

node Example/apex-sixteen-panel/prepare-pi.mjs \
  --model callstack/Apex-20260831 \
  --base-url https://api.callstack.ai/v1 \
  --pi-entry "$APEX_PI_ENTRY" \
  --credentials "$PWD/apex_api" \
  --out "$APEX_SHOWCASE"

node Example/apex-sixteen-panel/register-pi.mjs \
  --profiles "$APEX_SHOWCASE/commander-profiles.json"

npm run build
node dist/bin/agents-commander.js --conference --panels 16 --density auto "$APEX_SHOWCASE"
```

Use your actual endpoint and exact model ID. The Callstack catalog returned
`callstack/Apex-20260831`, earlier dated versions and a moving `callstack/Apex`
alias when checked on 2026-09-05. The dated selector keeps this example explicit.

The output directory must be new. Preparation creates private role prompts,
model settings, START/CONTINUE files and a profile fragment. Registration adds
these profiles to `~/.agents-commander/config.json`, preserving other settings.
An existing config receives a private backup before replacement. Re-registering
identical profiles is a no-op; conflicting IDs require an explicit edit.

Generated profiles pin the absolute Node executable used for preparation and
the Pi entry path. Regenerate/register appropriately if you relocate the
checkout or replace that Node installation. Doctor checks the executable;
the following smoke check also exercises Pi, authentication and model access.

## Live smoke check

This command makes one small model request:

```bash
node Example/apex-sixteen-panel/pi-runtime.mjs \
  --entry "$APEX_PI_ENTRY" \
  --agent-dir "$APEX_SHOWCASE/roles/apex-pi-requirements" \
  --credentials "$PWD/apex_api" \
  --model callstack/Apex-20260831 \
  --prompt "$APEX_SHOWCASE/roles/apex-pi-requirements/prompt.md" \
  --smoke
```

Expected response: `APEX_PI_READY`. A successful smoke check does not certify
the complete sixteen-agent review. Use the runbook to rehearse all seven waves.
The generator always records `liveModelVerified: false`; preparation alone
cannot establish live behavior.

## Operate the panels

Start with stable P1–P16 and launch the matching APEX Pi profile in each panel.
In F2, Up/Down chooses the profile and Left/Right (or a typed P-number) chooses
its target panel: selecting **APEX Pi P02** does not automatically target **P2**.
Choose an empty target to keep the first agent running alongside the second.
If **Replace Session** appears, the selected target is already occupied. Escape
or N keeps that session; Left/Up then Enter (or a click on Yes) replaces it.
For Ctrl+O, choosing the same running profile and panel reuses its session
without a replacement prompt.

Press Ctrl+P in every running session and wait for its plain-text acknowledgment.
Use Ctrl+O to send `start.txt` to the existing **APEX Pi P01 Coordinator** at P1.
Check each wave in F12, then send its next `CONTINUE APEX WAVE N` to that same
profile and panel. There are fifteen specialist tasks and fifteen replies.

F4 expands/restores the active panel; F11 finds panels; F7 changes their order.
Hidden sessions continue running. Commander reserves Ctrl+P for protocol
bootstrap, overriding Pi's model-cycling shortcut. Full collaboration timing and
the models' observance of wave instructions require rehearsal.

## Output budget and truncation

Preparation accepts `--max-tokens INTEGER`, from **256 to 16,384**. It sets the
output ceiling in every generated role's `models.json`, and records the same
value in `scenario.json` and `SETUP.txt`. For example, add `--max-tokens 8192` to
the preparation command above. The review council still defaults to **2,048**;
the separate broadcast test below defaults to **8,192**. Existing generated
directories and registered profiles are never silently rewritten.

These are requested limits, not verified APEX capabilities. Confirm that your
provider accepts the chosen ceiling; a higher ceiling may increase usage/cost.
The local context setting remains 32,768 tokens. The pinned Pi runtime reserves
4,096 context tokens and can reduce the actual requested output budget as the
conversation grows. Increasing the ceiling cannot guarantee completion.

Pi's **“Response was truncated before completion.”** means the provider reported
a length stop. Check **F12 before retrying**: a complete Commander frame might
already have routed before later output was cut off. A frame missing its matching
END is not routed, but remains buffered. Do not blindly continue or rebroadcast
it; inspect the results and use fresh sessions for a separate, manually authorized
attempt. Keep payloads short. Automatic retries and compaction remain disabled.

## Separate three-panel broadcast test

The sixteen-role council intentionally forbids BROADCAST. This separate scenario
uses three new profile IDs: one sender and two receivers that print local receipts
without REPLY, SEND, or rebroadcast. It does not change the council's prompts.

**Use a fresh Commander instance with only these three agents running.** BROADCAST
reaches all other connected running agents, including hidden panels—not only
profiles whose names contain “Broadcast”. A three-panel view does not isolate an
existing sixteen-agent workspace.

After installing Pi as above, close other Commander instances before registration.
Prepare a new private output directory; no model is called by these commands:

```bash
APEX_BROADCAST="$PWD/.commander-local/apex-pi-broadcast"
APEX_PI_ENTRY="$PWD/.commander-local/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"

node Example/apex-sixteen-panel/prepare-pi.mjs \
  --scenario broadcast-test --max-tokens 8192 \
  --model callstack/Apex-20260831 \
  --base-url https://api.callstack.ai/v1 \
  --pi-entry "$APEX_PI_ENTRY" \
  --credentials "$PWD/apex_api" \
  --out "$APEX_BROADCAST"

node Example/apex-sixteen-panel/register-pi.mjs \
  --profiles "$APEX_BROADCAST/commander-profiles.json"

npm run build
node dist/bin/agents-commander.js --conference --panels 3 --density 3 "$APEX_BROADCAST"
```

1. In **F2**, launch **APEX Pi Broadcast Sender** at stable **P1**,
   **APEX Pi Broadcast Receiver 1** at **P2**, and **Receiver 2** at **P3**.
   Select each target explicitly; profile labels do not pick panels for you.
2. Press **Ctrl+P** in each panel and wait for plain readiness acknowledgments.
3. Use **Ctrl+O** to send `START APEX BROADCAST` once to the existing sender at P1.
4. Inspect **F12** for two delivered broadcast records with the same short body.
   P2 and P3 should print `APEX_BROADCAST_RECEIVED P2` and
   `APEX_BROADCAST_RECEIVED P3` locally. No routed replies are expected.
5. Stop and inspect any missing receipt, length error, or extra route. Do not
   resend automatically. A new attempt requires fresh sessions and a new START.

The sender is instructed to emit one fixed body of at most 80 words, with no
preamble or trailing explanation. These are model instructions, not enforced
exactly-once delivery or a recipient allowlist. Offline tests verify generator
budgets and Commander fan-out, not live APEX compliance; generated metadata stays
`liveModelVerified: false`. Launching/bootstrapping agents and sending START use
the provider normally and can incur inference charges.

## Runtime and recording

The wrapper reads the key only when launching Pi, checks that its base URL
matches the generated provider config, and makes the key available through
`APEX_API_KEY`. Profiles and model JSON contain only a file path or environment
reference. The installed Pi CLI runs in the same process Commander manages.

These review roles disable tools, request `tool_choice: none` at the API, and
use the `max_tokens` field for output limits. The API-level tool setting matters:
the initial live test produced an unsolicited tool call with Pi's tools disabled,
then a rejected empty-tool-list follow-up. The explicit setting passed the round trip.
The roles disable context-file discovery, extensions, project
configuration loading and Pi session saving. Each panel receives its complete
fictional review brief as its system prompt. Startup update/telemetry requests,
automatic compaction and retries are disabled. Explicit model requests still
use the provider network. This configuration is for the text review showcase;
it does not enable Pi's normal code-editing tools.

The configured context limit is 32,768 tokens. Output ceilings are configurable
as described above; these are local settings, not a statement of model capacity.
Pi's zero default cost metadata does not establish that inference is free.
The provider timeout is 60 seconds. Stop or inspect a failed wave before
continuing; the model's wave instructions are not a scheduler.

Commander capture remains opt-in. Follow [the dataset guide](../../docs/datasets.md)
when recording. Captures identify `generic`; retain model/harness provenance
separately and keep the usual context and export review checks.

References: [Pi CLI options](https://pi.dev/docs/latest/usage),
[custom models](https://pi.dev/docs/latest/models),
[Pi environment](https://pi.dev/docs/latest/environment-variables).
