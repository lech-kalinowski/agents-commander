---
name: OWASP Top 10 Scan
description: Scan the codebase for all OWASP Top 10 vulnerabilities with severity ratings, file locations, and remediation steps
category: security
agents: [any]
panels: 1
---

Perform a comprehensive OWASP Top 10 security scan of this codebase. Systematically analyze every source file for vulnerabilities in each of the following categories. For each finding, assign a severity (Critical / High / Medium / Low / Informational), cite the exact file path and line number, and provide a concrete remediation code snippet.

**A01:2021 - Broken Access Control**
Search for missing authorization checks on endpoints, IDOR patterns where user-supplied IDs directly reference database objects, directory traversal via unsanitized file paths, CORS misconfigurations allowing wildcard origins, and metadata manipulation (JWT tampering, cookie modification). Check every route handler and controller for proper access control enforcement.

**A02:2021 - Cryptographic Failures**
Identify sensitive data transmitted without TLS, weak hashing algorithms (MD5, SHA1 for passwords), hardcoded encryption keys, missing encryption at rest for PII/financial data, and improper certificate validation. Examine database schemas for unencrypted sensitive columns.

**A03:2021 - Injection**
Scan for SQL injection (string concatenation in queries, missing parameterization), NoSQL injection, OS command injection (unsanitized input in exec/spawn calls), LDAP injection, and expression language injection. Check every point where user input flows into a query or command.

**A04:2021 - Insecure Design**
Look for missing rate limiting on authentication and sensitive operations, absence of fraud prevention patterns, lack of input validation at the domain model level, and business logic flaws such as price manipulation, workflow bypass, or race conditions in state transitions.

**A05:2021 - Security Misconfiguration**
Check for default credentials, unnecessary open ports or services, overly verbose error messages leaking stack traces, missing security headers, directory listing enabled, debug mode in production configs, and XML external entity processing enabled by default.

**A06:2021 - Vulnerable and Outdated Components**
Examine package manifests (package.json, requirements.txt, pom.xml, go.mod, Gemfile) and lock files for dependencies with known CVEs. Flag any unmaintained or end-of-life libraries. Check for components running with unnecessary privileges.

**A07:2021 - Identification and Authentication Failures**
Review for weak password policies, missing brute force protection, session fixation, session IDs in URLs, missing session invalidation on logout or password change, credential stuffing vulnerabilities, and plaintext credential storage or transmission.

**A08:2021 - Software and Data Integrity Failures**
Look for deserialization of untrusted data (pickle, Java serialization, JSON.parse of unvalidated input), missing integrity checks on CI/CD pipelines, unsigned software updates, and dependency confusion risks from misconfigured package registries.

**A09:2021 - Security Logging and Monitoring Failures**
Check for missing audit logs on login attempts, access control failures, and server-side input validation failures. Verify that logs do not contain sensitive data. Confirm alerting thresholds exist for suspicious activity patterns.

**A10:2021 - Server-Side Request Forgery (SSRF)**
Find any code that fetches URLs from user input without validating against an allowlist. Check for DNS rebinding vulnerabilities, access to cloud metadata endpoints (169.254.169.254), and internal service enumeration risks.

**Output Format:**
Organize findings by OWASP category. For each finding provide:
- Severity rating with justification
- Affected file(s) and line number(s)
- Description of the vulnerability and attack scenario
- Remediation with before/after code example
- References to relevant CWE identifiers

Conclude with a summary table showing total findings per severity level and the top 5 highest-risk items requiring immediate attention.
