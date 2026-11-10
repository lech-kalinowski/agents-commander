# Plain Shell and Antigravity QA

Feature validation, 2026-11-10. These features are included in 0.1.14, not
0.1.13. Exact-archive acceptance and registry publication are recorded separately
in the repository's [0.1.14 release record](https://github.com/lech-kalinowski/agents-commander/blob/main/docs/releases/0.1.14.md).

## Behavior

- Ctrl+T from a file panel or F2/S starts an interactive shell in that panel's
  directory. SHELL is an executable path, not a command string; account shell
  and /bin/sh provide fallbacks. Normal shell startup files still run.
- Plain shells do not join the agent registry, protocol, or semantic recorder.
  Ctrl+P reports that no agent is running. A live session requires confirmation
  before replacement; a session changed during confirmation is not replaced.
- Shell exit leaves a stopped terminal, without an automatic restart. Ctrl+T
  returns to files. As for other unmanaged commands, F6 copies an idle terminal
  at the original directory, not the shell's process state or command history.
- Antigravity uses `agy` and adapter `antigravity`. Gemini is deprecated and placed
  last in selectors, with a Doctor warning. Saved Gemini and configured generic
  CLI commands remain unchanged. No automatic migration, alias, sign-in, or
  permission-bypass flags are added.
- Bundled collaboration templates now use Antigravity. Explicit Gemini targets
  in custom/old templates still require Gemini. Select/update
  the intended template to use `<antigravity-panel>` for Antigravity; Commander
  must not silently redirect an explicit Gemini address.

## Automated Gate

Run with Node.js 22+ and Python 3:

```bash
npm ci
npm run verify
```

The gate covers type checking, unit/integration tests, Python bridge tests,
development watch, build, built CLI isolation, and packed-install checks.

The packed PTY test additionally exercises Ctrl+T and F2/S, real shell command
execution in the selected CWD, protocol rejection, default-No close cancellation,
confirmed return to files, exit without restart, and shutdown. Existing stress
checks retain 100 panels in both themes and twenty local synthetic agent PTYs.

Focused regressions cover shell resolution/fallback, dialog input isolation,
replacement races, Antigravity discovery, old config compatibility, exact routing
identities, template roles and consented capture/export validation.

## Real Provider Acceptance

With `agy` and `codex` installed and already authenticated, explicitly authorize
the paid, bounded smoke test:

```bash
npm run build
COMMANDER_LIVE_ANTIGRAVITY=1 node tests/live/antigravity-codex-communication.mjs
```

The test creates an empty temporary workspace, uses Antigravity plan mode with
its terminal sandbox and Codex read-only mode, and requests no tools. It trusts
only that newly created workspace. Initial theme/login setup is not automated;
complete that setup interactively before testing. No user configuration is
rewritten and no terminal transcripts, account details, or capability keys are
saved by the test. The provider CLIs retain their own normal session history.

Observed pass with installed Antigravity CLI 1.5.4:

- Antigravity SEND to Codex, followed by Codex REPLY and processed receipt.
- Codex SEND to Antigravity, followed by Antigravity REPLY and processed receipt.
- A second Antigravity-to-Codex round, without duplicate delivery.
- Antigravity QUERY ping, automatic PONG submission and processed receipt.
- Antigravity STATUS, automatic ACK submission and processed receipt.
- Exactly six routed deliveries, all delivered; both owned sessions stopped.

No manual Enter, resize, or rescue retry was used after workspace setup.
This is bounded communication coverage, not proof of every provider version,
custom plugin, shell startup file, or long-running workload. Publishing an npm
release still requires the separate release gates and registry verification.
