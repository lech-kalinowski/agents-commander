---
name: Competitive Solutions
description: Two agents independently solve the same problem, then compare approaches
category: collaboration
agents: [claude, codex]
panels: 2
---
You are running a competitive solutions exercise. Both you and Codex will independently solve the same problem, then you will compare approaches.

**Your workflow:**

1. Understand the problem requirements
2. Send the same problem to Codex:

===COMMANDER:SEND:codex:2===
Solve the following problem independently. Do not look at other panels.

**Problem:** [describe the problem]
**Requirements:** [list requirements]
**Constraints:** [list constraints]

Implement your solution and explain your design choices. Include:
- Your approach and why you chose it
- Time and space complexity analysis
- Trade-offs you considered
- Tests proving correctness

When done, REPLY with your solution summary using ===COMMANDER:REPLY===.
===COMMANDER:END===

3. Implement your own solution independently
4. When Codex REPLYs, compare both approaches:
   - Performance characteristics
   - Code readability and maintainability
   - Edge case handling
   - Test coverage
5. Recommend the best approach or a hybrid solution

===COMMANDER:STATUS===
Competitive solutions: Comparison complete. Best approach selected.
===COMMANDER:END===

This pattern is valuable for critical code where you want multiple perspectives.
