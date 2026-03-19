---
name: API Contract Testing
description: Write contract tests for API endpoints verifying schemas, status codes, error formats, pagination, authentication, and content negotiation.
category: testing
agents: [any]
panels: 1
---

Design and implement API contract tests that verify every endpoint adheres to its documented or expected contract. Follow this systematic approach:

## Step 1: API Discovery and Documentation
- Identify all API endpoints in the project (REST routes, GraphQL resolvers, RPC methods).
- For each endpoint, document: HTTP method, path, required headers, query parameters, request body schema, response schema, and possible status codes.
- If an OpenAPI/Swagger spec exists, use it as the source of truth. If not, derive the contract from the implementation.

## Step 2: Request Contract Tests
For each endpoint, test that it correctly validates incoming requests:
- **Required fields**: Omitting each required field individually returns a 400/422 with a descriptive error.
- **Type validation**: Sending wrong types (string where number expected, array where object expected) returns appropriate errors.
- **Format validation**: Invalid formats (malformed email, invalid date, too-long string) are rejected.
- **Extra fields**: Unexpected fields are either ignored or rejected, per the API's design contract.
- **Content-Type**: Sending incorrect Content-Type header returns 415 Unsupported Media Type.

## Step 3: Response Contract Tests
For each endpoint and status code, verify the response:
- **Success responses (2xx)**: Response body matches the documented schema exactly (required fields present, correct types, no extra fields if strict).
- **Error responses (4xx/5xx)**: Error body follows a consistent format with error code, message, and optional details.
- **Headers**: Required response headers are present (Content-Type, Cache-Control, CORS headers).
- **Status codes**: Each documented status code is reachable and correct for its scenario.

## Step 4: Authentication and Authorization Tests
- **Unauthenticated**: Requests without credentials return 401 with WWW-Authenticate header.
- **Invalid credentials**: Expired tokens, malformed tokens, wrong passwords return 401.
- **Insufficient permissions**: Valid user without required role returns 403.
- **Cross-tenant access**: User from tenant A cannot access tenant B resources (404, not 403, to avoid information leakage).

## Step 5: Pagination and Collection Tests
For list endpoints:
- Default pagination returns the documented page size.
- Page/offset parameters work correctly at boundaries (first page, last page, beyond last page).
- Sorting parameters produce correctly ordered results.
- Filtering parameters narrow results as expected.
- Empty collections return 200 with an empty array, not 404.

## Step 6: Edge Cases and Special Scenarios
- **Idempotency**: PUT and DELETE are idempotent (repeating the request yields the same result).
- **Concurrency**: Concurrent modifications are handled (optimistic locking returns 409 Conflict).
- **Rate limiting**: Exceeding rate limits returns 429 with Retry-After header.
- **Large payloads**: Requests exceeding size limits return 413 Payload Too Large.

## Step 7: Quality Checklist
- [ ] Every endpoint has at least one success and one error contract test.
- [ ] Request validation is tested for every required field.
- [ ] Response schemas are validated against a JSON Schema or equivalent.
- [ ] Authentication and authorization boundaries are tested per role.
- [ ] Pagination edge cases (empty, first, last page) are covered.
- [ ] Error responses follow a consistent format across all endpoints.
- [ ] Tests run against an in-process test server, not a live environment.

Output complete test files organized by API resource or endpoint group.
