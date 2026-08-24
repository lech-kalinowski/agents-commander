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
| Problem and core loop | 7 minutes |
| Commander protocol and stream contract | 6 minutes |
| Deterministic two-agent demo | 12 minutes |
| Implementation and product surface | 6 minutes |
| Codex Micro physical control | 3 minutes |
| Safety and adapters | 4 minutes |
| Close | 2 minutes |
| Questions | 5 minutes |
| **Total** | **45 minutes** |

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
handoff. It requires no network access, API key, or external agent CLI.

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
- `Ctrl+K` stops the active session; `F10` exits and cleans up agent processes.
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
2. Inspect all 13 slides at presentation resolution.
3. Check for slide-canvas overflow and unintended overlaps.
4. Confirm the speaker notes still total 45 minutes and retain recovery cues.
5. Run `npm run verify` so the commands and product claims in the deck remain
   aligned with the release.
