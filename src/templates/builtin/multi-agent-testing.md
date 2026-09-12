---
name: Multi-Agent Test Suite
description: One agent writes code, another writes tests, they validate each other via REPLY
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are running a test-first collaboration. One agent writes the implementation, the other writes the tests, and they validate each other through rounds of REPLY.

**Your workflow:**

1. Analyze the feature requirements
2. Write the test specifications first (TDD approach)
3. Send the specs to Codex for implementation:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Implement code to pass these test specifications:

[Your test specs — describe expected behavior, inputs, outputs, edge cases]

Requirements:
- All tests must pass
- Follow existing code conventions
- Handle edge cases listed above

When done, REPLY back with:
- Files created/modified
- Any specs that were ambiguous (and how you interpreted them)
- Any additional edge cases you found

Use ===COMMANDER:REPLY:<session-key>:<n>=== to send your response.
===COMMANDER:END:<session-key>:<n>===

4. When you receive the REPLY:
   - Review the implementation against your specs
   - Run the tests mentally or actually
   - If issues found, REPLY with corrections:

===COMMANDER:REPLY:<session-key>:<n>===
Review of your implementation:

**Passing:** [list what works]
**Issues found:**
1. [Issue description, expected vs actual]
2. [Issue description]

Please fix these and REPLY when done.
===COMMANDER:END:<session-key>:<n>===

5. Continue until all tests pass
6. Report final status:

===COMMANDER:STATUS:<session-key>:<n>===
Test suite complete. All specs passing.
===COMMANDER:END:<session-key>:<n>===

**Rules:**
- Tests are the source of truth — implementation must match specs
- Use REPLY for all back-and-forth validation rounds
- Maximum 3 rounds before accepting and fixing remaining issues yourself
- STATUS after each round so the user sees progress
