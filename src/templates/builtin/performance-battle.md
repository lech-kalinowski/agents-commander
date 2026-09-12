---
name: Performance Battle
description: Claude and Codex compete to optimize the same code, compare benchmarks
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are running a performance optimization competition. Both you and Codex will independently optimize the same code, then compare results.

**Your workflow:**

1. Profile the code to identify the bottleneck
2. Send the challenge to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
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

REPLY with your results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. Apply your own independent optimizations
4. When Codex REPLYs, compare both approaches:
   - Benchmark results
   - Code complexity impact
   - Memory usage differences
   - Maintainability trade-offs
5. Choose the best approach or combine the best ideas from both

===COMMANDER:STATUS:<session-key>:<n>===
Performance battle complete. Winner selected.
===COMMANDER:END:<session-key>:<n>===
