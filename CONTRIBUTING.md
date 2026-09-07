# Contributing to Agents Commander

Contributions should make local, operator-controlled agent collaboration easier
to understand, use and maintain. Please keep changes focused and make their
behavior and verification easy to review.

## Development setup

Use Node.js 22 or newer, Python 3, and macOS, Linux or WSL2. From a source checkout:

```bash
npm ci
npm run build
node dist/bin/agents-commander.js --doctor .
node dist/bin/agents-commander.js .
```

Use the built entrypoint or `npm start --` when testing this checkout. A globally
installed npm release may have a different version and different features.
The offline `node dist/bin/agents-commander.js --demo` requires no AI provider
account or API credentials.

Before submitting a change, run the complete local validation gate:

```bash
npm run verify
```

This checks types, application tests, hardware bridge tests, development watch
startup and cleanup, the production build, built CLI isolation and an
installed-package smoke test. Describe any
unavailable checks and their reason instead of marking them as passed. Unit
tests and offline fixtures do not prove live-model behavior or physical-device
compatibility.

Use the [QA coverage and manual checklist](docs/qa.md) to choose relevant
regressions. Check public dependency advisories with `npm audit` as a separate,
network-dependent check; it is intentionally not part of the offline test gate.

The development-only `tsup` → `esbuild` override selects the patched 0.28 line
for [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).
Commander uses build/watch, not the affected Windows development-server mode.
Keep the override covered by build/watch/package tests and remove it when
tsup's own dependency range includes a patched version. It does not add esbuild
to the published CLI's runtime dependencies.

## Scope and review

- Start with a small, reproducible problem or a concrete user workflow. For a
  substantial feature, discuss the scope in an issue before a large rewrite.
- Keep product changes separate from conference decks, speaker notes and
  promotional materials. Reusable examples belong with the project examples;
  conference-only instructions belong with the talk materials.
- Keep each pull request focused. Explain the behavior change, relevant risks,
  verification performed and any known limitations.
- Add regression coverage for bug fixes and update the affected help, guides
  and examples. Use `.js` extensions for TypeScript ESM imports.
- Preserve stable panel IDs, running-session identity and the distinction
  between message delivery and task completion. Do not weaken confirmation,
  capability or privacy checks to make a demo pass.
- Review substantial changes before implementation and again after testing.
  Contributor guidance for the source tree is in [AGENTS.md](AGENTS.md).

Keep feature work and release work separate. Pushing source does not publish an
npm package; do not change published-release claims without checking the actual
release. License changes require a separate explicit decision.

## Safe tests and reports

Never commit or attach API keys, authentication files, live Commander Protocol
capability keys, raw terminal transcripts, private captures, review candidates
or training datasets. Use synthetic examples and opaque placeholders. Inspect
screenshots and diagnostic output before sharing: paths, names, prompts and
error details can also be sensitive.

Capture is opt-in for each launch. Do not enable recording through saved
configuration or silently collect data for tests. See the
[dataset guide](docs/datasets.md) for capture and review boundaries.

Live-provider tests, including APEX/Pi collaboration, are optional and may incur
costs or send prompts to external services. Run them only when explicitly
chosen, with your own authorized credentials and a bounded scenario. Keep them
out of the default test gate, isolate them from existing agent sessions, and
never claim a live test passed based only on an offline fixture.

Bug reports should include the Commander version and installation method,
runtime/platform information, the smallest reproduction and the expected versus
actual result. Sanitized error text is useful; private logs are not required.
Do not disclose an unpatched security vulnerability or secret in a public issue.

## License

Agents Commander is open source under the [MIT License](LICENSE), including
commercial use. Only submit material that you have the right to contribute
under that license, and retain relevant copyright and
[third-party notices](THIRD_PARTY_NOTICES.md). Earlier published packages retain
the license bundled with those versions; changing source does not publish npm.
