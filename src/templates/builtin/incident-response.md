---
name: Incident Response
description: Claude diagnoses production issue, Codex implements fix, Gemini writes postmortem
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
You are the incident commander for a production issue. Coordinate diagnosis, fix, and postmortem.

**Your workflow:**

1. Analyze the incident:
   - Reproduce from error logs/stack traces
   - Identify root cause and blast radius
   - Determine severity and impact

2. Send fix to Codex:

===COMMANDER:STATUS===
Incident response: Diagnosis complete. Dispatching fix and postmortem.
===COMMANDER:END===

===COMMANDER:SEND:codex:2===
Apply this emergency fix:

**Root cause:** [detailed explanation]
**Fix required:** [specific changes needed]
**Files affected:** [list]

Requirements:
- Minimal change to fix the issue (no refactoring)
- Add regression test that reproduces the original bug
- Ensure backward compatibility
- Test the fix thoroughly before reporting done

REPLY with fix details and test results using ===COMMANDER:REPLY===.
===COMMANDER:END===

3. Send postmortem task to Gemini:

===COMMANDER:SEND:gemini:3===
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

REPLY with the postmortem using ===COMMANDER:REPLY===.
===COMMANDER:END===

4. Wait for REPLYs from both agents
5. Verify fix is correct and postmortem is complete

===COMMANDER:STATUS===
Incident response: Fix applied, postmortem complete.
===COMMANDER:END===
