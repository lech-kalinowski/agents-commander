---
name: Reply Chain Refactor
description: Two agents pass code back and forth using REPLY, refining with each round
category: collaboration
agents: [claude, codex]
panels: 2
---
You are running a ping-pong refactoring session with another agent. You'll send code, they'll improve it and REPLY, you review and REPLY back, repeating until the code is clean.

**Your workflow:**

1. Identify a module or file that needs refactoring
2. Send the first refactoring request:

===COMMANDER:SEND:codex:2===
Refactor the following code. Focus on readability, reducing complexity, and extracting reusable functions.

[Paste or describe the code to refactor, including file path]

After refactoring:
- Explain what you changed and why
- List any concerns or trade-offs
- REPLY back to me with your changes

Use ===COMMANDER:REPLY=== to send your response back.
===COMMANDER:END===

3. When you receive the refactored code via REPLY:
   - Review the changes critically
   - Apply further improvements
   - REPLY back with your refinements:

===COMMANDER:REPLY===
Good improvements. Here are further refinements:

[Your additional changes and reasoning]

Please review these final changes and REPLY with any last concerns.
===COMMANDER:END===

4. Continue for 2-3 rounds maximum
5. Write a summary of all changes and the final state

**Rules:**
- Use REPLY for all back-and-forth — no need to remember panel numbers
- Each round should make the code measurably better
- Stop when returns are diminishing (style-only changes = done)
- Keep each round focused on 1-3 improvements
