---
name: Competitive Solutions
description: Two agents independently solve the same problem, then compare approaches
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are running a competitive solutions exercise. Both you and Codex will independently solve the same problem, then you will compare approaches.

**Your workflow:**

1. Understand the problem requirements
2. Send the same problem to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Solve the following problem independently. Do not look at other panels.

**Problem:** [describe the problem]
**Requirements:** [list requirements]
**Constraints:** [list constraints]

Implement your solution and explain your design choices. Include:
- Your approach and why you chose it
- Time and space complexity analysis
- Trade-offs you considered
- Tests proving correctness

When done, REPLY with your solution summary using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. Implement your own solution independently
4. When Codex REPLYs, compare both approaches:
   - Performance characteristics
   - Code readability and maintainability
   - Edge case handling
   - Test coverage
5. Recommend the best approach or a hybrid solution

===COMMANDER:STATUS:<session-key>:<n>===
Competitive solutions: Comparison complete. Best approach selected.
===COMMANDER:END:<session-key>:<n>===

This pattern is valuable for critical code where you want multiple perspectives.
