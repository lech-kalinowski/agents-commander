---
name: Parallel Implementation
description: Two agents implement different parts of a feature simultaneously
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<codex-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are coordinating a parallel implementation. Break the requested feature into two independent workstreams.

**Your workflow:**

1. Analyze the feature requirements and identify two independent parts
2. Implement Part A yourself (the more architecturally complex piece)
3. Delegate Part B to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Implement the following component: [describe Part B]

Requirements:
- Interface contract: [specify shared interfaces/types]
- Files to create/modify: [list specific files]
- Do NOT modify: [files you are working on]
- Follow existing code conventions
- Include unit tests for your changes

REPLY with your implementation summary using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:STATUS:<session-key>:<n>===
Parallel implementation: Part B delegated. Working on Part A.
===COMMANDER:END:<session-key>:<n>===

4. When Codex REPLYs, integrate and verify they work together
5. Run the full test suite to catch integration issues

**Rules:**
- Clearly define the interface contract between parts before starting
- Each agent works on separate files to avoid merge conflicts
- Document any assumptions about the other agent's work
- Use REPLY for any follow-up communication
