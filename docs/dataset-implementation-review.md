# Dataset pipeline implementation review

Reviewed 2026-09-02 against the source branch, before and after implementation.
The [dataset guide](datasets.md) describes usage and limits; the
[original plan](session-capture-plan.md) retains deferred roadmap work.

## Pre-change review

- Keep capture opt-in per launch and separate from diagnostic logs and routing.
- Record accepted semantic frames before ledger truncation; retain actual input
  submission, broadcast emission identity and resolved REPLY references.
- Never persist live capability keys, raw keystrokes or unrestricted runtime
  objects. Redaction does not remove the need for human privacy/rights review.
- Keep one focal next response per candidate. Unknown context must remain unknown.
- Bind approvals to immutable candidates; freeze project/duplicate groups before
  export selection; keep synthetic fixtures distinct from real agent data.
- Make offline commands UI-independent and writes private, bounded and exclusive.

## Post-change findings resolved

| Finding | Resolution and regression coverage |
| --- | --- |
| Shutdown event used a hyphenated reason rejected by the recorder schema | Underscore machine codes; App lifecycle events checked against the real schema |
| Lexical storage checks missed symlinked workspaces and the default root | Canonical existing-ancestor comparison for both default and explicit paths |
| An event arriving as a writer drain settled could be omitted by close | Drain until empty; compare committed/admitted totals before completion; deterministic race test |
| Recorder option mutation could change final provenance | Capture options snapshotted before initialization |
| Frequent recorder callbacks could cause excessive terminal redraws | 50 ms coalescing, isolated errors, cancellation on disposal |
| Offline size preflight could race a manifest change | Reader enforces caller byte/event budgets within the validated read |
| A fully observed QUERY before the first task permanently excluded later data | Exclude the premature target but preserve observed history for later tasks |
| Approval selection could change train/test assignments | Group assignments frozen in the prepared manifest and verified during export |
| Review timestamps accepted date-only/ambiguous strings | Canonical ISO date-time validation and malformed timestamp tests |
| Bundled source manifests were only partly validated | Reuse strict capture-manifest validation, including totals |
| New tests used a macOS-only temporary path or real logger | Portable canonical temporary roots and mocked diagnostic logging |
| Shutdown test assumed an exact number of microtasks | Wait for the actual retired-panel drain entry before asserting cleanup order |
| PTY parent-loss fixture could exit before its children were ready under load | Bounded readiness handshake before simulating parent loss; production PTY behavior unchanged |
| Package privacy assertion confused a generated capture JavaScript chunk with a recording directory | Match directory boundaries explicitly; regression assertions retain nested capture and JSONL exclusions |

## Verification boundaries

Unit tests cover recorder limits/failures, private filesystem handling, schema
tampering, redaction, capability rotation, routing hooks, lifecycle shutdown,
review gates, deterministic export, split isolation and documentation.

Integration tests exercise the real streaming parser, orchestrator, recorder,
candidate preparation, fixture review, export and validation. Only terminal
endpoints are synthetic. These tests do not prove real-model reasoning quality.

Built-package tests check lazy dataset commands without UI dependencies and
exclude private captures/JSONL from npm. The standard handoff gate remains
`npm run verify`.

Final gate passed on Node.js 22.22.3: 65 JavaScript test files / 770 tests,
28 Python hardware tests, typecheck, production build, built CLI isolation and
packed-install smoke. No remaining actionable review findings were identified.

No permissioned real-data pilot, model download, tokenizer validation, LoRA/QLoRA
training, dataset publication or npm release was performed. Model-specific token
masks, context/EOS behavior and held-out quality remain separate acceptance gates.
