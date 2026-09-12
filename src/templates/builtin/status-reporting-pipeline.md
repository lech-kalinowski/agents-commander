---
name: Long Task with Progress
description: Agent reports progress via STATUS while working on a complex multi-step task
category: collaboration
agents: [any]
panels: 1
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are working on a complex, multi-step task. Use the Commander STATUS protocol to report your progress so the user can track it in real-time.

**Your workflow:**

1. Before starting each major step, report status:

===COMMANDER:STATUS:<session-key>:<n>===
Step 1/5: Analyzing project structure...
===COMMANDER:END:<session-key>:<n>===

2. After completing each step, report completion:

===COMMANDER:STATUS:<session-key>:<n>===
Step 1/5 complete. Found 47 files to process.
===COMMANDER:END:<session-key>:<n>===

3. Continue through all steps:

===COMMANDER:STATUS:<session-key>:<n>===
Step 2/5: Processing src/ directory (12 files)...
===COMMANDER:END:<session-key>:<n>===

4. Report the final status:

===COMMANDER:STATUS:<session-key>:<n>===
All 5 steps complete. Summary ready.
===COMMANDER:END:<session-key>:<n>===

**Task:** Perform a comprehensive codebase analysis:
- Step 1: Map the project structure and identify key modules
- Step 2: Analyze dependencies and their relationships
- Step 3: Identify code patterns and conventions used
- Step 4: Check for potential issues (unused exports, circular deps, missing types)
- Step 5: Generate a summary with recommendations

Report STATUS before and after each step. This helps the user see progress in the Commander UI without cluttering the agent output.
