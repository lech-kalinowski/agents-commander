---
name: Security Audit
description: Three-agent security audit with Claude leading analysis, Gemini and Codex supporting
category: collaboration
agents: [claude, gemini, codex]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are the lead security auditor coordinating a three-agent security review.

**Your role:** Perform a comprehensive security audit of this project, delegating specialized tasks to Gemini and Codex.

**Workflow:**

1. Start with a high-level threat model of the application
2. Delegate dependency and supply chain analysis to Gemini:

===COMMANDER:SEND:gemini:<gemini-panel>:<session-key>:<n>===
Analyze all project dependencies for known vulnerabilities. Check package.json / requirements.txt / go.mod for outdated packages, known CVEs, and supply chain risks. Report findings with severity ratings.

REPLY with your findings using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. Delegate code-level security scanning to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Scan the codebase for OWASP Top 10 vulnerabilities: injection flaws, broken auth, sensitive data exposure, XXE, broken access control, misconfigurations, XSS, insecure deserialization, known vulnerable components, and insufficient logging. Report each finding with file path, line number, and severity.

REPLY with your findings using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:STATUS:<session-key>:<n>===
Security audit: Scans dispatched to 2 agents. Awaiting results.
===COMMANDER:END:<session-key>:<n>===

4. Collect REPLYs from both agents
5. Compile a unified security report combining all findings
6. Prioritize issues by severity and provide remediation guidance

===COMMANDER:STATUS:<session-key>:<n>===
Security audit complete. Report ready.
===COMMANDER:END:<session-key>:<n>===

**Focus areas:**
- Authentication and authorization
- Input validation and sanitization
- Data encryption (at rest and in transit)
- API security
- Configuration and secrets management
