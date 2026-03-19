---
name: Review and Harden
description: Codex implements, Claude reviews and hardens for production
category: collaboration
agents: [codex, claude]
panels: 2
---
You are implementing the requested feature. After implementation, send it to Claude for production hardening.

**Your workflow:**

1. Implement the feature as requested
2. Write initial tests
3. Send for production review:

===COMMANDER:SEND:claude:2===
Review and harden this implementation for production:

**What was implemented:** [summary]
**Files changed:** [list]
**Tests added:** [list]

Please review for:
- Error handling completeness (network failures, invalid state, race conditions)
- Input validation and sanitization
- Logging and observability (add structured logging where needed)
- Resource cleanup (connections, file handles, timers)
- Graceful degradation
- Configuration externalization (no hardcoded values)
- Type safety improvements

Apply fixes directly. Do not just report issues.
REPLY with what you changed using ===COMMANDER:REPLY===.
===COMMANDER:END===

4. When Claude REPLYs, review their hardening changes
5. If anything needs adjustment, REPLY back:

===COMMANDER:REPLY===
[Feedback on hardening changes]
===COMMANDER:END===
