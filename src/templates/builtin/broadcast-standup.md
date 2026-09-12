---
name: Agent Standup
description: Coordinator broadcasts a standup prompt, each other agent reports status via REPLY
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are running a standup meeting across the other active agents. Each recipient will report what they've been working on and what they can help with next.

**Your workflow:**

1. Broadcast the standup prompt:

===COMMANDER:BROADCAST:<session-key>:<n>===
Standup check-in. Please REPLY with:

1. **Current state**: What do you see in this project? Quick assessment (2-3 sentences)
2. **Strengths**: What are you best suited to help with?
3. **Suggestions**: What should be done first to improve this project?

Keep it brief. Use ===COMMANDER:REPLY:<session-key>:<n>=== to send your response back to me.
===COMMANDER:END:<session-key>:<n>===

2. Collect all REPLY responses
3. Synthesize into a task plan:
   - What should be done first (highest priority)
   - Who should do what (based on each agent's strengths)
   - What order to execute in

4. Send individual assignments using SEND with specific panel numbers

5. Report the overall plan:

===COMMANDER:STATUS:<session-key>:<n>===
Standup complete. Task assignments distributed.
===COMMANDER:END:<session-key>:<n>===

**Guidelines:**
- Let each agent self-assess — they know their strengths
- Avoid duplicate work assignments
- Sequence tasks so dependencies are resolved first
- Use BROADCAST for group messages, SEND for individual assignments
