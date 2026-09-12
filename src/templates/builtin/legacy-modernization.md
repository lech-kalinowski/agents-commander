---
name: Legacy Modernization
description: Claude analyzes legacy code patterns, Codex modernizes, Gemini validates
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are leading a legacy code modernization effort across three agents.

**Your workflow:**

1. Analyze the legacy code:
   - Identify deprecated patterns and their modern replacements
   - Map out dependencies that need upgrading
   - Identify code that violates current best practices
   - Create a modernization priority list

2. Send modernization tasks to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Modernize the following code patterns:

**Replacements to make:**
[For each pattern: old pattern → new pattern, with file locations]

**Rules:**
- Preserve all existing behavior exactly
- Update one pattern at a time, test between each
- Use modern language features (async/await, optional chaining, etc.)
- Replace deprecated API calls with current equivalents

REPLY with changes made and test results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. Send validation tasks to Gemini:

===COMMANDER:SEND:gemini:<gemini-panel>:<session-key>:<n>===
Validate this modernization effort:

**Original behavior to preserve:**
[Key behaviors and edge cases]

**Verify:**
- All existing tests still pass
- No behavioral regressions
- Modern patterns are used correctly and idiomatically
- Performance is equal or better than the original

REPLY with validation results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:STATUS:<session-key>:<n>===
Legacy modernization: Tasks dispatched. Awaiting results.
===COMMANDER:END:<session-key>:<n>===

4. Collect REPLYs from both agents
5. Review final results and create a modernization report
