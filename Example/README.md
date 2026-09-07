# Examples

These examples demonstrate Agents Commander workflows. They are optional;
normal use does not require a particular model provider or conference setup.

## Offline collaboration demo

From a built source checkout:

```bash
node dist/bin/agents-commander.js --demo
```

The bundled deterministic demo uses two local scripted roles and a temporary
workspace. It needs no model, credentials, or network access. It demonstrates
routing mechanics, not model reasoning quality.

## APEX collaboration fixtures

- [Sixteen-panel review council](apex-sixteen-panel/README.md): one coordinator,
  fifteen specialists, and human-gated review waves using Pi or OpenCode.
- [Pi setup and broadcast test](apex-sixteen-panel/PI.md): credential loading,
  profile registration, configurable context/output limits, and a separate
  three-panel broadcast fixture.

The setup generators run offline. Live sessions require your own provider
access and may incur charges. Preparation and synthetic routing tests do not
establish a successful live collaboration run. A broadcast reaches all connected
agents, including hidden panels; use a fresh instance for the broadcast fixture.

Keep credentials, generated profiles, provider responses, and captured datasets
private. Do not commit them with example improvements. Capture is a separate,
explicit opt-in workflow described in the [dataset guide](../docs/datasets.md).

The APEX scripts are source-checkout examples, not part of the npm runtime.
Their existing directory is retained for compatibility with generated launch
profiles. The bundled offline demo is included in source builds and in packages
built from this checkout; this does not imply a new public npm release.
