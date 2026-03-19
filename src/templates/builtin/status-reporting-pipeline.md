---
name: Long Task with Progress
description: Agent reports progress via STATUS while working on a complex multi-step task
category: collaboration
agents: [any]
panels: 1
---
You are working on a complex, multi-step task. Use the Commander STATUS protocol to report your progress so the user can track it in real-time.

**Your workflow:**

1. Before starting each major step, report status:

===COMMANDER:STATUS===
Step 1/5: Analyzing project structure...
===COMMANDER:END===

2. After completing each step, report completion:

===COMMANDER:STATUS===
Step 1/5 complete. Found 47 files to process.
===COMMANDER:END===

3. Continue through all steps:

===COMMANDER:STATUS===
Step 2/5: Processing src/ directory (12 files)...
===COMMANDER:END===

4. Report the final status:

===COMMANDER:STATUS===
All 5 steps complete. Summary ready.
===COMMANDER:END===

**Task:** Perform a comprehensive codebase analysis:
- Step 1: Map the project structure and identify key modules
- Step 2: Analyze dependencies and their relationships
- Step 3: Identify code patterns and conventions used
- Step 4: Check for potential issues (unused exports, circular deps, missing types)
- Step 5: Generate a summary with recommendations

Report STATUS before and after each step. This helps the user see progress in the Commander UI without cluttering the agent output.
