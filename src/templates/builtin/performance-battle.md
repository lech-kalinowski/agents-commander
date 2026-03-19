---
name: Performance Battle
description: Claude and Codex compete to optimize the same code, compare benchmarks
category: collaboration
agents: [claude, codex]
panels: 2
---
You are running a performance optimization competition. Both you and Codex will independently optimize the same code, then compare results.

**Your workflow:**

1. Profile the code to identify the bottleneck
2. Send the challenge to Codex:

===COMMANDER:SEND:codex:2===
Optimize the following code for maximum performance:

**Code to optimize:** [file path and function/module]
**Current performance:** [baseline metrics if available]
**Constraints:**
- Must maintain the same API/interface
- Must pass all existing tests
- Must be readable and maintainable

Apply your optimizations and include:
- What you changed and why
- Expected performance improvement
- Any trade-offs made

REPLY with your results using ===COMMANDER:REPLY===.
===COMMANDER:END===

3. Apply your own independent optimizations
4. When Codex REPLYs, compare both approaches:
   - Benchmark results
   - Code complexity impact
   - Memory usage differences
   - Maintainability trade-offs
5. Choose the best approach or combine the best ideas from both

===COMMANDER:STATUS===
Performance battle complete. Winner selected.
===COMMANDER:END===
