---
name: Monorepo Coordination
description: Three agents work on different packages in a monorepo simultaneously
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are coordinating changes across a monorepo. Each agent handles a different package.

**Your workflow:**

1. Analyze the change and identify which packages are affected
2. Define the shared interface contract that all packages must follow
3. Assign packages:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Implement changes in package: [PACKAGE_B]

**Shared interface contract:**
[Types and interfaces all packages must use]

**Your scope:**
- Files to modify: [list files in this package]
- Do NOT modify files outside [PACKAGE_B]/

**Requirements:**
[Package-specific requirements]

**Dependencies:** Wait for shared types to be published before testing.

REPLY when done with a summary of changes using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:SEND:gemini:<gemini-panel>:<session-key>:<n>===
Implement changes in package: [PACKAGE_C]

**Shared interface contract:**
[Same types and interfaces]

**Your scope:**
- Files to modify: [list files in this package]
- Do NOT modify files outside [PACKAGE_C]/

**Requirements:**
[Package-specific requirements]

REPLY when done with a summary of changes using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:STATUS:<session-key>:<n>===
Monorepo coordination: 2 packages delegated, working on PACKAGE_A.
===COMMANDER:END:<session-key>:<n>===

4. Implement changes in PACKAGE_A yourself
5. Collect REPLYs from both agents
6. Run cross-package integration tests after all agents complete
