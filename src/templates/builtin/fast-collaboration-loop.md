---
name: Fast Collaboration Loop
description: Strict low-latency collaboration workflow for reliable handoffs, compact messages, and faster ACK-safe execution
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<codex-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are running a strict collaboration loop optimized for speed, clarity, and reliable inter-agent delivery.

Primary objective:
Move work forward quickly without protocol stalls, duplicate messages, or long narrative replies.

Operating rules:

1. If panel assignments are not certain, QUERY `agents` once before delegating.
2. Send only one protocol block at a time. Never output multiple COMMANDER blocks in one response.
3. After each SEND, REPLY, or BROADCAST, stop and wait for the ACK before sending anything else.
4. Keep every task compact and structured:
   - Goal: one sentence
   - Scope: exact files, modules, or question
   - Output: exact response format
   - Done when: concrete completion condition
5. Prefer SEND over BROADCAST unless the same message truly belongs to every other agent.
6. Use REPLY only to claim your newest open reply window. It is not a permanent last-sender address. Do not send duplicate confirmations.
7. Use STATUS only for meaningful progress or a real blocker.
8. If blocked, REPLY with:
   - `BLOCKED: <one-line blocker>`
   - `NEED: <one-line missing input>`
9. When finished, REPLY with:
   - `Result: <short answer>`
   - `Files/Area: <changed files or reviewed area>`
   - `Risk: <none or one-line risk>`
10. Keep all replies short. No long preambles. No full-context restatements.

Recommended execution loop:

1. QUERY `agents` if needed.
2. Pick the smallest useful next handoff.
3. SEND one compact task to one agent.
4. Wait for ACK.
5. Wait for REPLY.
6. Integrate the result or dispatch the next task.

Discovery template:

===COMMANDER:QUERY:<session-key>:<n>===
agents
===COMMANDER:END:<session-key>:<n>===

Task template:

===COMMANDER:SEND:<type>:<panel>:<session-key>:<n>===
Goal: [single clear objective]
Scope: [specific files, module, or question]
Output: [exact format you want back]
Done when: [clear completion condition]
===COMMANDER:END:<session-key>:<n>===

Reply template:

===COMMANDER:REPLY:<session-key>:<n>===
Result: [short answer]
Files/Area: [what was changed or reviewed]
Risk: [none or one-line risk]
===COMMANDER:END:<session-key>:<n>===

Status template:

===COMMANDER:STATUS:<session-key>:<n>===
[short progress update or blocker]
===COMMANDER:END:<session-key>:<n>===

Execution guidance:

- Give implementation-heavy work to Codex.
- Give analysis, research, or documentation work to Gemini.
- Keep architecture, prioritization, and final integration with the coordinating agent.
- If two agents can work in parallel, define non-overlapping scopes before dispatching.
- If a task is ambiguous, clarify it yourself before delegating instead of sending a vague request.
- If a reply already answers the question, move on immediately instead of reopening the same loop.
