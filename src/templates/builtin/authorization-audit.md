---
name: Authorization Audit
description: Audit access control implementation for RBAC/ABAC patterns, privilege escalation, and IDOR vulnerabilities
category: security
agents: [any]
panels: 1
---

Perform a detailed audit of the authorization and access control implementation in this codebase. Examine every endpoint, data access path, and privilege boundary for proper enforcement of the principle of least privilege.

**Access Control Model Analysis**
Identify the authorization model in use (RBAC, ABAC, ACL, or ad-hoc checks). Map all defined roles, permissions, and their hierarchies. Check for role definitions that are overly broad (e.g., an "admin" role with unrestricted access when finer-grained roles would be appropriate). Verify that the default permission stance is deny-all with explicit grants, not allow-all with explicit denials.

**Endpoint Authorization Coverage**
Enumerate every API endpoint and route handler. For each, verify that an authorization check is applied before business logic executes. Flag any endpoint that only checks authentication but not authorization. Look for endpoints that rely solely on client-side enforcement (hidden UI elements without server-side checks). Check that administrative endpoints are restricted to appropriate roles and not just hidden behind obscure URLs.

**Insecure Direct Object Reference (IDOR)**
Trace every path where user-supplied identifiers (IDs in URL params, request body, or query strings) are used to fetch resources. Verify that ownership or permission checks occur before data is returned. Flag patterns like `findById(req.params.id)` without verifying the requesting user has access to that resource. Check for sequential/predictable IDs that facilitate enumeration. Verify that bulk/list endpoints properly scope results to the authorized user's data.

**Privilege Escalation Risks**
Search for endpoints that allow users to modify their own roles or permissions. Check that role assignment operations require elevated privileges. Look for parameter manipulation opportunities where a user could inject a higher privilege level (e.g., adding `"role": "admin"` to a profile update request). Verify that mass assignment protections exist and sensitive fields are not user-writable. Check for horizontal privilege escalation where users in one tenant/organization can access another's data.

**Data Access Scoping**
Review database queries and ORM usage to ensure proper scoping. Check that multi-tenant applications enforce tenant isolation at the query level (not just the application layer). Verify that data export, reporting, and search features respect authorization boundaries. Look for caching mechanisms that might serve data across authorization boundaries.

**Authorization Middleware and Decorators**
Review the implementation of authorization middleware, guards, or decorators. Check for bypass conditions such as requests from internal IPs skipping authorization, debug flags that disable checks, or exception handling that defaults to allowing access on error. Verify that authorization decisions are logged for audit purposes.

**Workflow and State-Based Authorization**
For applications with workflows (e.g., approval processes, order states), verify that state transitions are authorized. Check that users cannot skip approval steps or revert states they should not control. Look for race conditions in concurrent state changes that could bypass authorization.

**File and Resource Access**
Verify that file upload/download endpoints enforce authorization. Check that users cannot access other users' uploaded files by manipulating paths or IDs. Ensure that temporary files, presigned URLs, and shared links have proper expiration and access controls.

**For each finding, provide:**
- Severity: Critical (full privilege escalation), High (cross-tenant data access), Medium (unauthorized read access), Low (information disclosure)
- Affected endpoint/function with file path and line number
- Proof-of-concept attack description showing how the flaw could be exploited
- Remediation with specific code changes implementing proper authorization
- Architectural recommendations for systemic issues (e.g., adopting a policy engine)
