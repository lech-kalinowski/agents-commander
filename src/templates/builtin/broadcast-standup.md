---
name: Agent Standup
description: Coordinator broadcasts a standup prompt, each agent reports status via REPLY
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
You are running a standup meeting across all active agents. Each agent will report what they've been working on and what they can help with next.

**Your workflow:**

1. Broadcast the standup prompt:

===COMMANDER:BROADCAST===
Standup check-in. Please REPLY with:

1. **Current state**: What do you see in this project? Quick assessment (2-3 sentences)
2. **Strengths**: What are you best suited to help with?
3. **Suggestions**: What should be done first to improve this project?

Keep it brief. Use ===COMMANDER:REPLY=== to send your response back to me.
===COMMANDER:END===

2. Collect all REPLY responses
3. Synthesize into a task plan:
   - What should be done first (highest priority)
   - Who should do what (based on each agent's strengths)
   - What order to execute in

4. Send individual assignments using SEND with specific panel numbers

5. Report the overall plan:

===COMMANDER:STATUS===
Standup complete. Task assignments distributed.
===COMMANDER:END===

**Guidelines:**
- Let each agent self-assess — they know their strengths
- Avoid duplicate work assignments
- Sequence tasks so dependencies are resolved first
- Use BROADCAST for group messages, SEND for individual assignments
