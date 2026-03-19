---
name: Input Validation Hardening
description: Review and harden all input validation against injection attacks, path traversal, SSRF, and template injection
category: security
agents: [any]
panels: 1
---

Perform an exhaustive review of all input validation in this codebase. Trace every entry point where external data enters the application and verify that it is properly validated, sanitized, and constrained before use. Identify missing or insufficient validation and provide hardened implementations.

**SQL Injection**
Find all database query construction points. Flag any string concatenation or template literal interpolation used to build SQL queries. Verify that parameterized queries or prepared statements are used consistently. Check ORM usage for raw query escape hatches that bypass parameterization. Look for second-order injection where stored data is later used unsafely in queries. Test for blind SQL injection vectors in search, filter, and sort parameters.

**Command Injection**
Locate all calls to exec, spawn, system, popen, subprocess, or equivalent process execution functions. Flag any that include user-controlled input in the command string. Verify that arguments are passed as arrays (not shell-interpreted strings). Check for indirect command injection through filenames, environment variables, or configuration values derived from user input. Ensure that shell metacharacters (;, |, &&, $(), backticks) are properly escaped or rejected.

**Path Traversal**
Find all file system operations that reference paths derived from user input. Check for directory traversal sequences (../, ..\, URL-encoded variants %2e%2e%2f). Verify that path canonicalization is performed before access checks. Ensure that file operations are restricted to intended directories using allowlists or chroot-style path validation. Check for null byte injection in file paths that could truncate extensions.

**Server-Side Request Forgery (SSRF)**
Identify all code that makes HTTP requests using URLs or hostnames from user input. Verify that URL validation includes scheme restriction (https only), hostname validation against an allowlist, and blocking of internal/private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fc00::/7). Check for DNS rebinding vulnerabilities where validation occurs before resolution. Ensure redirect-following is disabled or validates each hop.

**Template Injection (SSTI)**
Check server-side template engines for user-controlled template content. Verify that user input is only placed in data contexts, never in template code contexts. Look for patterns where user input is rendered as a template rather than passed as a variable. Check for client-side template injection in frameworks like Angular, Vue, or React that could lead to XSS.

**Cross-Site Scripting (XSS)**
Identify all output rendering points where user data is displayed. Verify that context-appropriate encoding is applied: HTML entity encoding for HTML body, attribute encoding for HTML attributes, JavaScript encoding for script contexts, URL encoding for URL parameters. Check for DOM-based XSS through unsafe sinks (innerHTML, document.write, eval, setTimeout with strings). Verify that Content-Security-Policy headers are set to mitigate XSS impact.

**Deserialization**
Find all points where serialized data from external sources is deserialized. Flag unsafe deserialization functions (Java ObjectInputStream, Python pickle/yaml.load, PHP unserialize, Ruby Marshal, Node.js node-serialize). Verify that JSON parsing does not use reviver functions that execute arbitrary code. Check for prototype pollution in JavaScript through JSON.parse or deep merge operations.

**Data Type and Range Validation**
Verify that numeric inputs have minimum/maximum bounds enforced server-side. Check that string inputs have length limits. Ensure that enum-type inputs are validated against an allowlist of permitted values. Verify that date/time inputs are parsed strictly. Check that array/collection inputs have cardinality limits to prevent resource exhaustion.

**For each finding, provide:**
- Severity based on impact: Critical (RCE), High (data breach), Medium (data manipulation), Low (information disclosure)
- Input entry point: endpoint, parameter name, file path, line number
- Current validation (if any) and why it is insufficient
- Hardened implementation with defensive code example
- Recommended validation library or framework feature to use
