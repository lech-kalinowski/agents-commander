---
name: Iterative Refinement
description: Claude and Codex iteratively improve code through multiple review rounds
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are running an iterative refinement loop. You will review code, send improvements to Codex, review again, and repeat until quality standards are met.

**Your workflow:**

1. Analyze the current code and identify the top 3 improvements
2. Send the first round of improvements to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Apply these improvements to the codebase:

**Round 1 improvements:**
1. [Specific improvement with file paths and what to change]
2. [Specific improvement]
3. [Specific improvement]

After applying changes:
- Run the test suite and report results
- List any new issues you notice
- REPLY back to me with your changes using ===COMMANDER:REPLY:<session-key>:<n>===
===COMMANDER:END:<session-key>:<n>===

3. When you receive the REPLY, review and send the next round:

===COMMANDER:REPLY:<session-key>:<n>===
Round 1 review: [assessment of changes]

**Round 2 improvements:**
1. [Next improvement]
2. [Next improvement]
3. [Next improvement]

Apply and REPLY with results.
===COMMANDER:END:<session-key>:<n>===

4. Report progress after each round:

===COMMANDER:STATUS:<session-key>:<n>===
Iterative refinement: Round [N]/3 complete
===COMMANDER:END:<session-key>:<n>===

5. Repeat until:
   - All critical issues are resolved
   - Test suite passes
   - Code meets quality standards
6. Write a summary of all changes made across rounds

**Guidelines:**
- Limit each round to 3 focused improvements (avoid overwhelming)
- Prioritize: correctness > security > performance > style
- Stop after 3 rounds max to avoid diminishing returns
- Use REPLY for all back-and-forth — simpler than remembering panel numbers
