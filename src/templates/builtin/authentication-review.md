---
name: Authentication Review
description: Review authentication implementation for security issues including password handling, sessions, tokens, and MFA
category: security
agents: [any]
panels: 1
---

Conduct a comprehensive security review of the authentication system in this codebase. Examine every aspect of user identity verification, session management, and credential handling against current security best practices.

**Password Storage and Handling**
Verify that passwords are hashed using a modern adaptive algorithm (bcrypt with cost factor >= 12, scrypt, or Argon2id). Flag any use of MD5, SHA-1, SHA-256, or unsalted hashing for passwords. Check that salts are unique per user and cryptographically random. Ensure passwords are never logged, included in error messages, or returned in API responses. Verify that password comparison uses constant-time comparison to prevent timing attacks.

**Password Policy Enforcement**
Check minimum length requirements (should be at least 8, preferably 12+ characters). Verify that the system checks passwords against known breached password databases (Have I Been Pwned API or a local k-anonymity check). Ensure maximum length is reasonable (no less than 64 characters) to allow passphrases. Check that password complexity rules are not overly restrictive in ways that reduce entropy (e.g., requiring exactly one special character).

**Session Management**
Verify session IDs are generated with a CSPRNG and have at least 128 bits of entropy. Check that sessions are invalidated on logout, password change, and privilege escalation. Ensure session tokens are not exposed in URLs or logs. Verify appropriate session timeout values (idle timeout and absolute timeout). Check for session fixation vulnerabilities where pre-authentication session IDs survive login. Confirm that concurrent session limits exist where appropriate.

**Token-Based Authentication (JWT/OAuth)**
If JWTs are used: verify the algorithm is explicitly set (not "none"), check that RS256 or ES256 is preferred over HS256 for distributed systems, ensure tokens have reasonable expiration times, verify refresh token rotation is implemented, and check that JWTs are not stored in localStorage (prefer httpOnly cookies). For OAuth: verify state parameter is used to prevent CSRF, check redirect URI validation is strict (no open redirects), and ensure PKCE is used for public clients.

**Multi-Factor Authentication (MFA)**
Check if MFA is supported and how it is implemented. Verify TOTP implementation uses SHA-1/SHA-256 with 6-8 digit codes and 30-second windows. Ensure backup/recovery codes are single-use and stored hashed. Check that MFA bypass mechanisms are properly secured. Verify MFA enrollment flow cannot be hijacked.

**Brute Force and Credential Stuffing Protection**
Check for rate limiting on login endpoints (should lock after 5-10 failed attempts). Verify account lockout mechanism exists with automatic unlock after a cooldown period. Ensure failed login responses do not reveal whether the username or password was incorrect (use generic messages). Check for CAPTCHA integration after repeated failures. Verify that rate limiting applies per-account AND per-IP to prevent distributed attacks.

**Account Recovery**
Review password reset flow for token predictability, expiration (should expire within 1 hour), and single-use enforcement. Check that reset tokens are not sent as URL query parameters in GET requests. Verify that security questions, if used, are not easily guessable. Ensure account recovery does not inadvertently confirm account existence.

**Authentication Bypass Risks**
Search for debug or backdoor authentication mechanisms, hardcoded test credentials, API endpoints missing authentication middleware, authentication logic that can be bypassed via parameter manipulation, and race conditions in authentication state changes.

**For each finding, provide:**
- Severity (Critical / High / Medium / Low)
- The specific file, function, and line where the issue exists
- The security risk and potential attack scenario
- Concrete remediation code showing the secure implementation
- References to relevant standards (NIST SP 800-63B, OWASP ASVS)
