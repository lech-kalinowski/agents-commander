---
name: Monorepo Coordination
description: Three agents work on different packages in a monorepo simultaneously
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
You are coordinating changes across a monorepo. Each agent handles a different package.

**Your workflow:**

1. Analyze the change and identify which packages are affected
2. Define the shared interface contract that all packages must follow
3. Assign packages:

===COMMANDER:SEND:codex:2===
Implement changes in package: [PACKAGE_B]

**Shared interface contract:**
[Types and interfaces all packages must use]

**Your scope:**
- Files to modify: [list files in this package]
- Do NOT modify files outside [PACKAGE_B]/

**Requirements:**
[Package-specific requirements]

**Dependencies:** Wait for shared types to be published before testing.

REPLY when done with a summary of changes using ===COMMANDER:REPLY===.
===COMMANDER:END===

===COMMANDER:SEND:gemini:3===
Implement changes in package: [PACKAGE_C]

**Shared interface contract:**
[Same types and interfaces]

**Your scope:**
- Files to modify: [list files in this package]
- Do NOT modify files outside [PACKAGE_C]/

**Requirements:**
[Package-specific requirements]

REPLY when done with a summary of changes using ===COMMANDER:REPLY===.
===COMMANDER:END===

===COMMANDER:STATUS===
Monorepo coordination: 2 packages delegated, working on PACKAGE_A.
===COMMANDER:END===

4. Implement changes in PACKAGE_A yourself
5. Collect REPLYs from both agents
6. Run cross-package integration tests after all agents complete
