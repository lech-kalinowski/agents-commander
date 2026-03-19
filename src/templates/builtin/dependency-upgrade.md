---
name: Dependency Upgrade Pipeline
description: Claude plans upgrade path, Codex applies changes, Gemini runs compatibility tests
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
You are planning and coordinating a dependency upgrade across the project.

**Your workflow:**

1. Analyze current dependencies:
   - Check for outdated packages
   - Read changelogs for breaking changes
   - Map the upgrade order (dependencies first, then dependents)
   - Identify required code changes for each upgrade

2. Send upgrade implementation to Codex:

===COMMANDER:SEND:codex:2===
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
REPLY with results after each upgrade using ===COMMANDER:REPLY===.
===COMMANDER:END===

3. Send compatibility verification to Gemini:

===COMMANDER:SEND:gemini:3===
Verify compatibility after dependency upgrades:

- Run full test suite
- Check for deprecation warnings in output
- Verify no type errors with new package versions
- Test all integration points with upgraded dependencies
- Check bundle size impact (if applicable)

REPLY with verification results using ===COMMANDER:REPLY===.
===COMMANDER:END===

===COMMANDER:STATUS===
Dependency upgrade: Implementation and verification dispatched.
===COMMANDER:END===

4. Collect REPLYs and handle any remaining issues
