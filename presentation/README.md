# Code Europe conference session

`Agents_Commander_Protocol.pptx` is the canonical 45-minute Code Europe deck.
It includes presenter notes, recovery cues, and source references for technical
claims.

The previous Keynote export and Python generators were removed because they had
drifted from the product. They described an older release and could recreate
claims that are no longer accurate. Update the canonical PowerPoint directly,
preserving its existing theme and slide order, then render and inspect every
slide before committing it.

## Session shape

| Segment | Time |
| --- | ---: |
| Problem and core loop | 6 minutes |
| Commander protocol and stream contract | 9 minutes |
| Deterministic two-agent demo | 12 minutes |
| Implementation and product surface | 7 minutes |
| Safety, adapters, and controls | 6 minutes |
| Questions | 5 minutes |

## Demo preflight

Use Node.js 22 or newer and Python 3.

```bash
npm ci
npm run verify
npm run build
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
handoff. It requires no network access, API key, or external agent CLI.

For the optional experimental Codex Micro segment, allow the presentation
terminal under macOS Input Monitoring, verify the native device probe, and
complete the physical-control checklist before opening the audience-facing run:

```bash
node dist/bin/agents-commander.js --doctor --codex-micro .
node dist/bin/agents-commander.js --codex-micro-test .
node dist/bin/agents-commander.js --conference --codex-micro .
```

Conference and Demo modes do not enable the controller automatically. Prefer a
wired USB-C connection on stage and keep a normal keyboard ready. Native input
can verify the exact device and read safe status metadata; it does not read
serial numbers, update firmware, or control RGB lighting. Guarded Approve and
Reject controls remain off unless `--codex-micro-decisions` is added. See [the
Codex Micro rehearsal guide](../docs/codex-micro.md) for the physical mapping,
keyboard fallback, and rehearsal.

## On-stage recovery

- `F12` opens routed activity; `Shift+F12` opens the protocol guide.
- `Ctrl+O` reruns orchestration if the seeded exchange needs to be replayed.
- Press `Tab` to focus a file panel, then `Ctrl+E` returns to a two-panel
  baseline after confirming any live sessions. A running terminal receives the
  key instead of resetting the layout.
- `Ctrl+K` stops the active session; `F10` exits and cleans up agent processes.
- If any external agent or conference network is unreliable, switch to
  `--demo` and continue with the same protocol story.
- If Codex Micro input is unreliable, disconnect it and continue with the
  documented keyboard shortcuts; no agent session depends on the device.

## Deck quality checks

Before replacing the committed PowerPoint:

1. Render the exported `.pptx`, not only the editor preview.
2. Inspect all 12 slides at presentation resolution.
3. Check for slide-canvas overflow and unintended overlaps.
4. Confirm the speaker notes still total 45 minutes and retain recovery cues.
5. Run `npm run verify` so the commands and product claims in the deck remain
   aligned with the release.
