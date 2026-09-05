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
Press Ctrl+P in every running session and wait for its plain-text acknowledgment.
Use Ctrl+O to send `start.txt` to the existing **APEX Pi P01 Coordinator** at P1.
Check each wave in F12, then send its next `CONTINUE APEX WAVE N` to that same
profile and panel. There are fifteen specialist tasks and fifteen replies.

F4 expands/restores the active panel; F11 finds panels; F7 changes their order.
Hidden sessions continue running. Commander reserves Ctrl+P for protocol
bootstrap, overriding Pi's model-cycling shortcut. Full collaboration timing and
the models' observance of wave instructions require rehearsal.

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

The configured context limit is 32,768 tokens and output limit 2,048 tokens.
These are conservative local settings, not a statement of model capacity.
Pi's zero default cost metadata does not establish that inference is free.
The provider timeout is 60 seconds. Stop or inspect a failed wave before
continuing; the model's wave instructions are not a scheduler.

Commander capture remains opt-in. Follow [the dataset guide](../../docs/datasets.md)
when recording. Captures identify `generic`; retain model/harness provenance
separately and keep the usual context and export review checks.

References: [Pi CLI options](https://pi.dev/docs/latest/usage),
[custom models](https://pi.dev/docs/latest/models),
[Pi environment](https://pi.dev/docs/latest/environment-variables).
