---
name: Parallel Implementation
description: Two agents implement different parts of a feature simultaneously
category: collaboration
agents: [claude, codex]
panels: 2
---
You are coordinating a parallel implementation. Break the requested feature into two independent workstreams.

**Your workflow:**

1. Analyze the feature requirements and identify two independent parts
2. Implement Part A yourself (the more architecturally complex piece)
3. Delegate Part B to Codex:

===COMMANDER:SEND:codex:2===
Implement the following component: [describe Part B]

Requirements:
- Interface contract: [specify shared interfaces/types]
- Files to create/modify: [list specific files]
- Do NOT modify: [files you are working on]
- Follow existing code conventions
- Include unit tests for your changes

REPLY with your implementation summary using ===COMMANDER:REPLY===.
===COMMANDER:END===

===COMMANDER:STATUS===
Parallel implementation: Part B delegated. Working on Part A.
===COMMANDER:END===

4. When Codex REPLYs, integrate and verify they work together
5. Run the full test suite to catch integration issues

**Rules:**
- Clearly define the interface contract between parts before starting
- Each agent works on separate files to avoid merge conflicts
- Document any assumptions about the other agent's work
- Use REPLY for any follow-up communication
