---
name: Security Headers Check
description: Review HTTP security headers including CSP, HSTS, cookie flags, and browser security policies
category: security
agents: [any]
panels: 1
---

Review all HTTP security header configurations in this codebase. Examine server configuration, middleware setup, and response handling to ensure comprehensive browser-side security controls are properly implemented.

**Content-Security-Policy (CSP)**
Locate the CSP header configuration. Verify that it exists and is not set to an overly permissive policy. Check each directive:
- `default-src` should be 'self' at minimum, not '*'
- `script-src` must not include 'unsafe-inline' or 'unsafe-eval' (these negate most XSS protection). If needed, use nonce-based or hash-based policies instead
- `style-src` should avoid 'unsafe-inline' where possible; use nonces for inline styles
- `img-src` should be restricted to known image sources
- `connect-src` should whitelist only required API endpoints and WebSocket URLs
- `frame-ancestors` should be 'none' or 'self' to prevent clickjacking (replaces X-Frame-Options)
- `object-src` should be 'none' to prevent Flash/plugin-based attacks
- `base-uri` should be 'self' to prevent base tag injection
- `form-action` should restrict form submission targets
- Check for report-uri or report-to directive for CSP violation monitoring
- Verify that CSP is not weakened by a meta tag that overrides the header

**Strict-Transport-Security (HSTS)**
Verify that the HSTS header is set with max-age of at least 31536000 (one year). Check that includeSubDomains is present to protect all subdomains. Verify that the preload directive is included and the domain is submitted to the HSTS preload list. Ensure HSTS is set on the HTTPS response, not just HTTP redirects. Check that there are no mixed-content issues that would break under strict HSTS.

**X-Content-Type-Options**
Verify that X-Content-Type-Options: nosniff is set on all responses, especially those serving user-uploaded content. This prevents MIME type sniffing attacks where browsers interpret files as executable content.

**X-Frame-Options**
Check that X-Frame-Options is set to DENY or SAMEORIGIN. Note that frame-ancestors in CSP supersedes this but X-Frame-Options should still be set for older browser compatibility. Verify that framing is not selectively allowed for untrusted origins.

**Referrer-Policy**
Verify that Referrer-Policy is set to strict-origin-when-cross-origin or no-referrer. This prevents leaking URL paths (which may contain tokens or sensitive parameters) to external sites. Check that individual pages handling sensitive data (login, payment) use no-referrer specifically.

**Permissions-Policy (formerly Feature-Policy)**
Review the Permissions-Policy header to ensure unused browser features are disabled:
- camera=(), microphone=(), geolocation=() unless explicitly needed
- payment=() unless the app processes payments
- usb=(), bluetooth=(), midi=() for web applications
- interest-cohort=() to opt out of FLoC tracking
Verify that permissions are granted only to specific origins when required, not broadly.

**Cookie Security Flags**
Examine all Set-Cookie headers and cookie configuration:
- Secure flag must be set (cookies only sent over HTTPS)
- HttpOnly flag must be set on session cookies (prevents JavaScript access)
- SameSite attribute should be Strict or Lax (prevents CSRF). Verify that SameSite=None is only used with Secure flag for cross-site cookies that genuinely require it
- Domain attribute should not be overly broad (e.g., .example.com when app.example.com would suffice)
- Path attribute should be as restrictive as possible
- Max-Age or Expires should be set with appropriate lifetimes
- __Host- or __Secure- cookie prefixes should be used for additional guarantees

**Cache-Control for Sensitive Responses**
Verify that responses containing sensitive data include Cache-Control: no-store, no-cache, must-revalidate and Pragma: no-cache. Check that authenticated pages are not cached by CDNs or shared proxies. Ensure that the Vary header is set appropriately to prevent cache poisoning.

**Additional Headers**
- X-DNS-Prefetch-Control: off to prevent DNS prefetching of external links on sensitive pages
- Cross-Origin-Embedder-Policy (COEP) and Cross-Origin-Opener-Policy (COOP) for cross-origin isolation
- Cross-Origin-Resource-Policy (CORP) to prevent unauthorized cross-origin reads

**For each finding, provide:**
- Severity: High (missing critical header like CSP or HSTS), Medium (weak configuration), Low (missing optional hardening)
- Where the header should be configured (server config file, middleware, or response handler)
- The exact header value to set, with explanation of each directive
- Testing instructions: browser DevTools steps or curl commands to verify the header is present and correct
- Impact description of what attacks the missing/misconfigured header enables
