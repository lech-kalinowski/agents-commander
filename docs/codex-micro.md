# Codex Micro setup and rehearsal

Codex Micro support in Agents Commander is experimental and opt-in. Version 1 treats the controller as a standard keyboard HID: Work Louder Input emits reserved keyboard shortcuts, and Commander translates those shortcuts into panel, navigation, and guarded decision actions.

There is no native device dependency. Commander does not currently identify whether an event came from a Codex Micro, read device state, or control the device's RGB lighting.

## Program the controls

Create an Agents Commander layer in Work Louder Input with these exact assignments:

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+PageUp` | Previous panel |
| `Ctrl+Shift+PageDown` | Next panel |
| `Ctrl+Shift+Home` | Previous panel page |
| `Ctrl+Shift+End` | Next panel page |
| `Ctrl+Shift+F5` | Focus visible slot 1 |
| `Ctrl+Shift+F6` | Focus visible slot 2 |
| `Ctrl+Shift+F7` | Focus visible slot 3 |
| `Ctrl+Shift+F8` | Focus visible slot 4 |
| `Ctrl+Shift+F9` | Panel navigator |
| `Ctrl+Shift+F10` | Routed-message Activity |
| `Ctrl+Shift+F11` | Guarded one-time approval |
| `Ctrl+Shift+F12` | Guarded rejection |
| `Ctrl+Shift+Insert` | Control test overlay |

Keep the assignments exact. The navigation controls intentionally avoid
`Ctrl+Shift+Arrow`, which macOS Mission Control and Spaces can intercept.
Other modified function keys are not assumed to be distinguishable across
every terminal.

## Enable and test

Start the interactive control checklist in the project you will use on stage:

```bash
agents-commander --codex-micro-test /path/to/project
```

Press every programmed control. The overlay marks each semantic action as it reaches Commander. Use `R` to reset the checklist and `Esc` or `Q` to close it.

The startup diagnostic can also confirm that hardware mode is enabled, while
making the keyboard-HID limitation explicit:

```bash
agents-commander --doctor --codex-micro /path/to/project
```

Doctor cannot identify the physical device; the interactive checklist is the
actual end-to-end input test.

For a normal run, enable the integration explicitly:

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
      "decisionControls": true
    }
  }
}
```

`--codex-micro-test` enables the integration for that run and opens the checklist. Conference Mode and Demo Mode do not enable it implicitly.

## Approval and rejection safety

The decision controls are intentionally conservative. Approval or rejection is available only for the active, managed Codex session and only when Commander can still recognize the corresponding currently selected prompt option. A confirmation remains required, and Commander checks the session and visible prompt again immediately before submitting Enter.

The approval control is limited to a one-time approval. It never selects a persistent "always allow" choice. An unknown prompt, a changed prompt, a different selection, or a session change fails closed and sends nothing.

Set `hardware.codexMicro.decisionControls` to `false` for navigation-only use.

## Conference rehearsal

1. Connect the Codex Micro by USB-C. A wired connection is the preferred stage path; Bluetooth remains a convenience path.
2. Open Work Louder Input and confirm the Agents Commander layer is active.
3. Run `agents-commander --codex-micro-test` and complete all 13 checks.
4. Start the actual conference command with `--codex-micro` added explicitly.
5. Exercise page navigation with more panels than the visible density.
6. Test approval and rejection against a disposable Codex task, then test an unrelated or changed prompt to confirm it fails closed.
7. Keep a conventional keyboard connected and rehearse the normal F-key and `Tab` fallbacks.

The checklist validates that the expected keyboard shortcuts reach Agents Commander. It cannot prove the identity, battery condition, connection quality, or RGB state of a physical device. Complete this rehearsal on the exact presentation computer, terminal, connection mode, and Codex CLI version that will be used on stage.
