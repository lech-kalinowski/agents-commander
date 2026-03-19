---
name: Legacy Modernization
description: Claude analyzes legacy code patterns, Codex modernizes, Gemini validates
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
You are leading a legacy code modernization effort across three agents.

**Your workflow:**

1. Analyze the legacy code:
   - Identify deprecated patterns and their modern replacements
   - Map out dependencies that need upgrading
   - Identify code that violates current best practices
   - Create a modernization priority list

2. Send modernization tasks to Codex:

===COMMANDER:SEND:codex:2===
Modernize the following code patterns:

**Replacements to make:**
[For each pattern: old pattern → new pattern, with file locations]

**Rules:**
- Preserve all existing behavior exactly
- Update one pattern at a time, test between each
- Use modern language features (async/await, optional chaining, etc.)
- Replace deprecated API calls with current equivalents

REPLY with changes made and test results using ===COMMANDER:REPLY===.
===COMMANDER:END===

3. Send validation tasks to Gemini:

===COMMANDER:SEND:gemini:3===
Validate this modernization effort:

**Original behavior to preserve:**
[Key behaviors and edge cases]

**Verify:**
- All existing tests still pass
- No behavioral regressions
- Modern patterns are used correctly and idiomatically
- Performance is equal or better than the original

REPLY with validation results using ===COMMANDER:REPLY===.
===COMMANDER:END===

===COMMANDER:STATUS===
Legacy modernization: Tasks dispatched. Awaiting results.
===COMMANDER:END===

4. Collect REPLYs from both agents
5. Review final results and create a modernization report
