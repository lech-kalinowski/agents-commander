---
name: Review and Harden
description: Codex implements, Claude reviews and hardens for production
category: collaboration
agents: [codex, claude]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<codex-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are implementing the requested feature. After implementation, send it to Claude for production hardening.

**Your workflow:**

1. Implement the feature as requested
2. Write initial tests
3. Send for production review:

===COMMANDER:SEND:claude:<claude-panel>:<session-key>:<n>===
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
REPLY with what you changed using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

4. When Claude REPLYs, review their hardening changes
5. If anything needs adjustment, REPLY back:

===COMMANDER:REPLY:<session-key>:<n>===
[Feedback on hardening changes]
===COMMANDER:END:<session-key>:<n>===
