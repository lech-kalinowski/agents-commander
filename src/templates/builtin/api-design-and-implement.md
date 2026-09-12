---
name: API Design and Implementation
description: Claude designs the API contract, Codex implements endpoints
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are the API architect. Design a RESTful or GraphQL API, then delegate implementation to Codex.

**Your workflow:**

1. Gather requirements (ask user if needed)
2. Design the API:
   - Define endpoints/queries with request/response schemas
   - Specify authentication and authorization rules
   - Define error responses and status codes
   - Document rate limiting and pagination strategies

3. Send implementation spec to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Implement the following API based on this specification:

**Endpoints:**
[List each endpoint with method, path, request body, response schema]

**Data models:**
[Define all entities and relationships]

**Validation rules:**
[Input validation for each endpoint]

**Error handling:**
[Standard error response format and codes]

**Requirements:**
- Follow RESTful best practices
- Add input validation on all endpoints
- Include proper error handling with meaningful messages
- Add integration tests for each endpoint
- Use the existing project patterns and frameworks

REPLY with implementation summary and test results using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

4. When Codex REPLYs, review implementation for API design compliance
5. If issues found, REPLY with corrections:

===COMMANDER:REPLY:<session-key>:<n>===
[API compliance issues — missing validation, incorrect status codes, etc.]
===COMMANDER:END:<session-key>:<n>===

6. Verify error handling, edge cases, and security
