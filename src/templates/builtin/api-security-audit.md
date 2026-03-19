---
name: API Security Audit
description: Audit API security including rate limiting, authentication, CORS, error handling, and security headers
category: security
agents: [any]
panels: 1
---

Perform a comprehensive API security audit of this codebase. Examine every API endpoint for proper security controls, analyzing the request lifecycle from ingress to response for vulnerabilities and misconfigurations.

**Authentication and Authorization on Endpoints**
Map every API route and verify that authentication middleware is applied. Identify endpoints that are intentionally public and confirm this is appropriate. Check that API key validation occurs early in the middleware chain before business logic. Verify that different API consumers (admin, user, service-to-service) have distinct authentication mechanisms with appropriate trust levels. Flag any endpoint that accepts multiple authentication methods without properly prioritizing them.

**Rate Limiting and Throttling**
Check that rate limiting is implemented on all endpoints, with stricter limits on authentication, password reset, and resource-intensive operations. Verify that rate limits are applied per-user AND per-IP to prevent both abuse from a single account and distributed attacks. Check that rate limit responses include Retry-After headers. Ensure that rate limiting cannot be bypassed by modifying X-Forwarded-For or similar headers. Verify that rate limit state is shared across application instances (using Redis or equivalent).

**Input Validation and Request Constraints**
Verify that request body size limits are enforced (to prevent DoS via large payloads). Check that Content-Type validation rejects unexpected media types. Ensure that query parameter arrays and nested objects have depth and cardinality limits. Verify that pagination parameters (limit, offset) have enforced maximum values. Check that file upload endpoints validate file type, size, and content (not just extension).

**Error Handling and Information Leakage**
Verify that error responses use generic messages and do not expose stack traces, database errors, internal paths, or framework versions. Check that different error conditions (invalid credentials vs. non-existent user) return identical response times and status codes to prevent enumeration. Ensure that validation errors provide enough detail for legitimate clients without revealing internal data models. Verify that 500 errors are logged server-side but return sanitized responses to clients.

**CORS Configuration**
Review Access-Control-Allow-Origin settings. Flag wildcard (*) origins, especially when credentials are allowed (which browsers block but misconfiguration indicates intent issues). Verify that origin validation uses strict comparison, not substring or regex matching that could be bypassed. Check that Access-Control-Allow-Methods and Access-Control-Allow-Headers are restrictive. Ensure preflight responses have appropriate Access-Control-Max-Age values.

**Security Headers**
Verify presence and correctness of: Content-Security-Policy, Strict-Transport-Security (with includeSubDomains and preload), X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, and Permissions-Policy restricting unnecessary browser features. Check that API responses include Cache-Control: no-store for sensitive data.

**Request and Response Security**
Check that sensitive data (tokens, passwords, PII) is never included in URL query parameters (which are logged by proxies and browsers). Verify that responses containing sensitive data include appropriate Cache-Control headers. Ensure that JSONP is not supported (CORS is the modern alternative). Check for HTTP method override headers (_method, X-HTTP-Method-Override) that could bypass security filters.

**API Versioning and Deprecation Security**
Verify that deprecated API versions still receive security patches. Check that version negotiation cannot be manipulated to force use of older, less secure API versions. Ensure that internal-only API versions are not accessible externally.

**GraphQL-Specific Checks (if applicable)**
Disable introspection in production. Implement query depth and complexity limits. Check for batching attacks. Verify field-level authorization. Ensure that GraphQL error messages do not leak schema information.

**Webhook Security (if applicable)**
Verify that outgoing webhooks use HTTPS. Check that incoming webhooks validate signatures (HMAC). Ensure webhook endpoints are idempotent and handle replay attacks. Verify timeout and retry configurations.

**For each finding, provide:**
- Severity classification with CVSS-style impact and exploitability assessment
- Affected endpoint(s), HTTP method, and file location
- Attack scenario demonstrating the vulnerability
- Remediation with middleware configuration or code changes
- Testing guidance: curl commands or test cases to verify the fix
