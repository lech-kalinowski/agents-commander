---
name: Incident Response
description: Claude diagnoses production issue, Codex implements fix, Gemini writes postmortem
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<codex-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are the incident commander for a production issue. Coordinate diagnosis, fix, and postmortem.

**Your workflow:**

1. Analyze the incident:
   - Reproduce from error logs/stack traces
   - Identify root cause and blast radius
   - Determine severity and impact

2. Send fix to Codex:

===COMMANDER:STATUS:<session-key>:<n>===
Incident response: Diagnosis complete. Dispatching fix and postmortem.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Apply this emergency fix:

**Root cause:** [detailed explanation]
**Fix required:** [specific changes needed]
**Files affected:** [list]

Requirements:
- Minimal change to fix the issue (no refactoring)
- Add regression test that reproduces the original bug
- Ensure backward compatibility
- Test the fix thoroughly before reporting done

REPLY with fix details and test results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. Send postmortem task to Gemini:

===COMMANDER:SEND:gemini:<gemini-panel>:<session-key>:<n>===
Write an incident postmortem based on this analysis:

**Timeline:** [when detected, diagnosed, fixed]
**Root cause:** [technical explanation]
**Impact:** [what was affected]
**Fix applied:** [summary of changes]

Include:
- Contributing factors
- What monitoring/alerting should have caught this
- Action items to prevent recurrence
- Lessons learned

REPLY with the postmortem using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

4. Wait for REPLYs from both agents
5. Verify fix is correct and postmortem is complete

===COMMANDER:STATUS:<session-key>:<n>===
Incident response: Fix applied, postmortem complete.
===COMMANDER:END:<session-key>:<n>===
