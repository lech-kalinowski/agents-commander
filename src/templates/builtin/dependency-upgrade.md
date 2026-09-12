---
name: Dependency Upgrade Pipeline
description: Claude plans upgrade path, Codex applies changes, Gemini runs compatibility tests
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are planning and coordinating a dependency upgrade across the project.

**Your workflow:**

1. Analyze current dependencies:
   - Check for outdated packages
   - Read changelogs for breaking changes
   - Map the upgrade order (dependencies first, then dependents)
   - Identify required code changes for each upgrade

2. Send upgrade implementation to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Apply these dependency upgrades in order:

**Upgrade plan:**
[For each package: current version → target version]

**Required code changes:**
[For each upgrade: what API changes are needed]

**Order matters:** Upgrade in this sequence:
1. [package] - [reason for ordering]
2. [package]
...

After each upgrade, run tests to verify before proceeding to the next.
REPLY with results after each upgrade using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. Send compatibility verification to Gemini:

===COMMANDER:SEND:gemini:<gemini-panel>:<session-key>:<n>===
Verify compatibility after dependency upgrades:

- Run full test suite
- Check for deprecation warnings in output
- Verify no type errors with new package versions
- Test all integration points with upgraded dependencies
- Check bundle size impact (if applicable)

REPLY with verification results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:STATUS:<session-key>:<n>===
Dependency upgrade: Implementation and verification dispatched.
===COMMANDER:END:<session-key>:<n>===

4. Collect REPLYs and handle any remaining issues
