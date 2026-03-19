---
name: Frontend-Backend Split
description: Claude builds frontend, Codex builds backend, Gemini writes tests
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
You are coordinating a full-stack feature across three agents. You handle the frontend.

**Your workflow:**

1. Define the feature contract (API types, endpoints, data flow)
2. Send backend work to Codex:

===COMMANDER:SEND:codex:2===
Implement the backend for this feature:

**API endpoints needed:**
[List endpoints with request/response types]

**Database changes:**
[Schema changes, migrations needed]

**Business logic:**
[Rules and validations]

Use the existing backend patterns. Expose the API endpoints and export types.
REPLY with endpoint details and test results using ===COMMANDER:REPLY===.
===COMMANDER:END===

3. Send test requirements to Gemini:

===COMMANDER:SEND:gemini:3===
Write comprehensive tests for this feature:

**API contract:**
[The agreed API types and endpoints]

**Test coverage needed:**
- Unit tests for business logic
- Integration tests for API endpoints
- E2E tests for the full user flow
- Edge cases: [list specific scenarios]

Wait for backend implementation to complete before running tests.
REPLY with test results using ===COMMANDER:REPLY===.
===COMMANDER:END===

===COMMANDER:STATUS===
Full-stack split: Backend and tests dispatched. Building frontend.
===COMMANDER:END===

4. Implement the frontend (UI components, state management, API calls)
5. Collect REPLYs and coordinate integration once all parts are ready
