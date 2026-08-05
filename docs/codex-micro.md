# Codex Micro setup and rehearsal

Codex Micro support in Agents Commander is experimental and opt-in. Native
mode reads the shipping factory controls directly through a small bundled
bridge, so the controller does not need an Agents Commander layer in Work
Louder Input. Native mode supports both USB and Bluetooth on macOS and is the
default when the integration is enabled.

The bridge is deliberately narrow: it recognizes the Codex Micro vendor and
product IDs, requests safe device status, and receives control events. It does
not read or store a serial number, change firmware, access files, or control
RGB lighting.

## Native control map

| Physical control | Device input | Agents Commander action |
| --- | --- | --- |
| Agent 1 | `AG00` | Focus active workspace slot 1 |
| Agent 2 | `AG01` | Focus active workspace slot 2 |
| Agent 3 | `AG02` | Focus active workspace slot 3 |
| Agent 4 | `AG03` | Focus active workspace slot 4 |
| Agent 5 | `AG04` | Focus active workspace slot 5 |
| Agent 6 | `AG05` | Focus active workspace slot 6 |
| Fast | `ACT06` | Cycle visible panel density |
| Approve | `ACT07` | Guarded one-time approval, if enabled |
| Reject | `ACT08` | Guarded rejection, if enabled |
| Split | `ACT09` | Add a panel |
| Wide Mic key | `ACT10` + `ACT11` | Open routed-message Activity once |
| Codex | `ACT12` | Open the panel navigator |
| Dial press | `ENC_CLK` | Open routed-message Activity |
| Dial clockwise | `ENC_CW` | Focus next panel |
| Dial counter-clockwise | `ENC_CC` | Focus previous panel |
| Joystick up | — | Previous panel page |
| Joystick down | — | Next panel page |
| Joystick left | — | Focus previous panel |
| Joystick right | — | Focus next panel |

The wide Mic key reports two adjacent inputs; Commander de-duplicates them into
one action. The joystick must return toward center before another directional
action fires. An active workspace slot is the first, second, and so on among
the panels that still exist; after a panel is removed, its stable panel number
may differ from its slot. Use the Codex key's navigator to jump by stable panel
number or metadata.

## Enable and test native input

Native mode requires macOS and Python 3. Give the terminal application that
launches Agents Commander permission under **System Settings > Privacy &
Security > Input Monitoring**. Restart that terminal after changing the
permission.

Connect the device, then run the bounded startup probe:

```bash
agents-commander --doctor --codex-micro /path/to/project
```

Doctor reports whether the exact controller is connected and may show the
transport, firmware version, and battery level. It never prints a device
serial number. Next, open the interactive physical-input checklist:

```bash
agents-commander --codex-micro-test /path/to/project
```

Press and move every control you plan to use. The overlay shows connection
state and marks each semantic action as it reaches Commander. Use `R` to reset
the checklist, the arrow keys to scroll on a stage-sized terminal, and `Esc` or
`Q` to close it. The overlay also states whether Approve/Reject actions are
enabled; even while disabled, their raw inputs can still be tested safely.

For a normal run, enable native input explicitly:

```bash
agents-commander --codex-micro /path/to/project
```

To override an enabled configuration for one run:

```bash
agents-commander --no-codex-micro /path/to/project
```

The equivalent persistent configuration is:

```json
{
  "hardware": {
    "codexMicro": {
      "enabled": true,
      "inputMode": "native",
      "decisionControls": false
    }
  }
}
```

`--codex-micro-test` enables the integration for that run and opens the
checklist. Conference Mode and Demo Mode do not enable it implicitly.

## Approval and rejection safety

Decision controls are disabled by default. Enable them only when the physical
workflow has been rehearsed:

```bash
agents-commander --codex-micro --codex-micro-decisions /path/to/project
```

Approval or rejection is available only for the active, managed Codex session
and only while Commander still recognizes the corresponding selected prompt
option. A human confirmation remains required, and Commander checks the
device connection, session, and visible prompt again immediately before
submitting Enter. A physical decision press opens a five-second confirmation
window; press that same device key again before the dialog expires.

The approval control is limited to a one-time approval. It never selects a
persistent "always allow" choice. An unknown prompt, a changed prompt, a
different selection, a disconnected controller, or a session change fails
closed and sends nothing.

## Legacy keyboard fallback

Native input currently requires macOS. Linux users, or users who already have
an Agents Commander layer in Work Louder Input, can enable the old
programmed-shortcut path explicitly:

```bash
agents-commander --codex-micro-keyboard /path/to/project
```

| Work Louder Input shortcut | Agents Commander action |
| --- | --- |
| `Ctrl+Shift+PageUp` | Previous panel |
| `Ctrl+Shift+PageDown` | Next panel |
| `Ctrl+Shift+Home` | Previous panel page |
| `Ctrl+Shift+End` | Next panel page |
| `Ctrl+Shift+F5` through `Ctrl+Shift+F8` | Focus visible slots 1–4 |
| `Ctrl+Shift+F9` | Panel navigator |
| `Ctrl+Shift+F10` | Routed-message Activity |
| `Ctrl+Shift+F11` | Guarded one-time approval |
| `Ctrl+Shift+F12` | Guarded rejection |
| `Ctrl+Shift+Insert` | Control test overlay |

Keep these assignments exact. This mode receives ordinary terminal keyboard
events, so Doctor cannot prove which physical device sent them; complete the
interactive checklist instead.

## Conference rehearsal

1. Connect the Codex Micro by USB-C and select its wired device mode. Keep a
   conventional keyboard connected as the stage fallback.
2. Run `agents-commander --doctor --codex-micro` and resolve every Codex Micro
   warning, including Input Monitoring permission.
3. Run `agents-commander --codex-micro-test` and exercise every control used in
   the talk.
4. Start the audience-facing command with `--codex-micro` added explicitly.
5. Exercise navigation with more panels than the visible density.
6. If decision controls are part of the demo, enable them explicitly and test
   approval and rejection against a disposable Codex task. Confirm that an
   unrelated, changed, or stale prompt sends nothing.
7. Unplug and reconnect the controller once, confirm the status recovers, and
   rehearse continuing with the keyboard if it does not.

Complete the rehearsal on the exact presentation computer, terminal,
connection mode, and Codex CLI version that will be used on stage.
