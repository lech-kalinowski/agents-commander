---
name: Frontend-Backend Split
description: Claude builds frontend, Codex builds backend, Gemini writes tests
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
**Addressing:** Resolve role placeholders such as `<codex-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are coordinating a full-stack feature across three agents. You handle the frontend.

**Your workflow:**

1. Define the feature contract (API types, endpoints, data flow)
2. Send backend work to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Implement the backend for this feature:

**API endpoints needed:**
[List endpoints with request/response types]

**Database changes:**
[Schema changes, migrations needed]

**Business logic:**
[Rules and validations]

Use the existing backend patterns. Expose the API endpoints and export types.
REPLY with endpoint details and test results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. Send test requirements to Gemini:

===COMMANDER:SEND:gemini:<gemini-panel>:<session-key>:<n>===
Write comprehensive tests for this feature:

**API contract:**
[The agreed API types and endpoints]

**Test coverage needed:**
- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for the full user flow
- Edge cases: [list specific scenarios]

Wait for backend implementation to complete before running tests.
REPLY with test results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:STATUS:<session-key>:<n>===
Full-stack split: Backend and tests dispatched. Building frontend.
===COMMANDER:END:<session-key>:<n>===

4. Implement the frontend (UI components, state management, API calls)
5. Collect REPLYs and coordinate integration once all parts are ready
