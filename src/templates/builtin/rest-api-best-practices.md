---
name: REST API Best Practices
description: Review REST API implementation. Check: proper HTTP methods, status codes, resource naming, HATEOAS links, pagination, filtering, sorting, versioning, content negotiation, documentation.
category: backend
agents: [any]
panels: 1
---
You are a REST API design expert. Review or design the REST API implementation in this project.

**Evaluate and provide recommendations for:**

1. **Resource Naming and URL Structure**
   - Verify resources use plural nouns (e.g., /users, /orders) not verbs
   - Check URL hierarchy reflects resource relationships (/users/:id/orders)
   - Ensure consistent casing (kebab-case for URLs, camelCase for JSON fields)
   - Verify query parameters are used for filtering, not path segments
   - Look for action-oriented endpoints that should be restructured as resources

2. **HTTP Methods**
   - Verify correct method usage: GET (read), POST (create), PUT (full replace), PATCH (partial update), DELETE
   - Check that GET requests are safe (no side effects) and idempotent
   - Verify PUT and DELETE are idempotent
   - Ensure POST is used only for non-idempotent creation operations
   - Check for method misuse (GET with request body, POST for retrieval)

3. **Status Codes**
   - Verify appropriate status codes: 200 (OK), 201 (Created), 204 (No Content), 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 409 (Conflict), 422 (Unprocessable Entity), 429 (Too Many Requests), 500 (Internal Server Error)
   - Check that error responses include a consistent error body (code, message, details)
   - Verify 201 responses include a Location header with the created resource URL
   - Ensure 204 is used for successful DELETE operations with no response body

4. **Pagination**
   - Implement cursor-based or offset-based pagination for list endpoints
   - Include pagination metadata (total count, next/prev links, page size)
   - Set sensible default and maximum page sizes
   - Verify pagination works correctly with filtering and sorting

5. **Filtering, Sorting, and Field Selection**
   - Implement consistent query parameter patterns for filtering (e.g., ?status=active&created_after=2024-01-01)
   - Support multi-field sorting with direction (e.g., ?sort=created_at:desc,name:asc)
   - Implement sparse fieldsets to reduce payload size (e.g., ?fields=id,name,email)
   - Validate and sanitize all filter and sort parameters

6. **Versioning**
   - Evaluate the versioning strategy: URL path (/v1/), header (Accept-Version), or content type
   - Check for a deprecation policy and communication plan for old versions
   - Ensure backward compatibility within a major version
   - Document breaking changes between versions

7. **Content Negotiation and HATEOAS**
   - Support Accept and Content-Type headers properly
   - Include hypermedia links for discoverability where appropriate
   - Return self-links and related resource links in responses
   - Consider JSON:API, HAL, or similar hypermedia formats

8. **Documentation**
   - Verify OpenAPI/Swagger specification is complete and up to date
   - Check that all endpoints, parameters, request bodies, and responses are documented
   - Include example requests and responses for each endpoint
   - Ensure authentication requirements are clearly documented

**Provide a detailed API review report with specific violations, corrected examples, and a prioritized remediation plan.**
