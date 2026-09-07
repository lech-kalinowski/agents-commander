# Documentation

Start with the [project README](../README.md) for installation, requirements,
panel controls, agent setup, and the Commander Protocol. Documentation on a
development branch describes that source version, not necessarily the latest
published npm package.

## User guides

- [Protocol and routing](../README.md#inter-agent-communication): session
  capabilities, SEND, REPLY, BROADCAST, STATUS, QUERY, and Activity.
- [Configuration](../README.md#configuration): agent profiles and layout settings.
- [Keyboard shortcuts](../README.md#keyboard-shortcuts): panel-first controls.
- [Codex Micro](codex-micro.md): experimental hardware input and safety guards.
- [Capture and datasets](datasets.md): explicit recording consent, private
  storage, human review, and offline conversational dataset export.
- [Runnable examples](../Example/README.md): offline demo and optional live-model
  collaboration fixtures.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup, verification,
and pull-request scope. Current source is open source under the
[MIT License](../LICENSE), including commercial use. Retain the copyright and
permission notice and the applicable [third-party notices](../THIRD_PARTY_NOTICES.md).

## Proposals and research

These documents explain design ideas and tradeoffs. They are not a promise of
available features or a substitute for the user guides above.

- [Session capture roadmap](session-capture-plan.md): implemented capture/export
  foundations and deferred work, including replay and model training.
- [Protocol AI research](commander-protocol-ai-research.md).
- [Protocol positioning](commander-protocol-uniqueness-and-originality.md).
- [Potential applications and license boundaries](commander-protocol-commercial.md).

## Historical reviews

Review records describe a particular implementation checkpoint, not the current
release status or current test count.

- [Documentation audit, 2026-09-02](documentation-audit-2026-09-02.md).
- [Dataset implementation review, 2026-09-02](dataset-implementation-review.md).

## Conference material

The [conference material index](../talks/README.md) is separate
from product documentation. They are not runtime dependencies and are not
included in the npm package.
