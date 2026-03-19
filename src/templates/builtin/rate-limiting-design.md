---
name: Rate Limiting Design
description: Design rate limiting: token bucket vs sliding window algorithms, per-user vs per-endpoint limits, distributed rate limiting, graceful degradation, rate limit headers, retry-after guidance.
category: backend
agents: [any]
panels: 1
---
You are a rate limiting and API protection specialist. Design or review the rate limiting implementation for this project.

**Address the following areas:**

1. **Algorithm Selection**
   - Evaluate rate limiting algorithms for each use case:
     - **Token Bucket:** Allows bursts up to bucket size, refills at steady rate. Best for APIs allowing short bursts.
     - **Sliding Window Log:** Tracks exact request timestamps. Most accurate but memory-intensive.
     - **Sliding Window Counter:** Approximates sliding window with fixed window counters. Good accuracy-to-performance ratio.
     - **Fixed Window Counter:** Simple but allows double-rate at window boundaries.
     - **Leaky Bucket:** Smooths request rate to a constant output. Best for rate-sensitive downstream services.
   - Recommend the appropriate algorithm for each endpoint category
   - Document the tradeoffs in accuracy, memory, and computational cost

2. **Limit Configuration**
   - Define per-endpoint rate limits based on resource cost and expected usage patterns
   - Implement tiered limits by user role or subscription level (free, pro, enterprise)
   - Set separate limits for read vs write operations
   - Configure burst allowances for endpoints that naturally have bursty traffic
   - Define global rate limits as a safety net in addition to per-endpoint limits
   - Plan for special limits on authentication endpoints (login, password reset) to prevent brute force

3. **Distributed Rate Limiting**
   - Implement centralized rate limiting using Redis or a similar distributed store
   - Handle Redis unavailability gracefully (fail open vs fail closed, with justification)
   - Minimize latency overhead of distributed rate limit checks
   - Handle clock synchronization issues across application instances
   - Consider local rate limiting as a first layer before distributed checks
   - Evaluate sliding window counter implementations for distributed environments

4. **Identification and Scoping**
   - Define rate limit keys: authenticated user ID, API key, IP address, or combination
   - Handle shared IP scenarios (corporate NATs, VPNs) to avoid penalizing legitimate users
   - Implement separate limits per scope (per user per endpoint, per user global, per IP)
   - Handle unauthenticated requests with IP-based limiting
   - Support rate limit key customization for multi-tenant architectures

5. **Response Headers and Client Guidance**
   - Include standard rate limit headers in every response:
     - `X-RateLimit-Limit`: Maximum requests allowed in window
     - `X-RateLimit-Remaining`: Requests remaining in current window
     - `X-RateLimit-Reset`: Unix timestamp when the window resets
   - Return 429 (Too Many Requests) with a `Retry-After` header
   - Include a descriptive error body explaining the limit and when to retry
   - Document rate limits in API documentation with examples

6. **Graceful Degradation**
   - Implement progressive degradation before hard rate limiting (slower responses, reduced functionality)
   - Prioritize critical operations when near rate limits (allow login, block bulk exports)
   - Implement request queuing or throttling as an alternative to outright rejection
   - Design client-side backoff behavior guidance in documentation
   - Consider implementing a quota system with soft and hard limits

7. **Monitoring and Alerting**
   - Track rate limit hit rates per endpoint and per user tier
   - Alert on sudden spikes in rate-limited requests (potential abuse or misconfigured client)
   - Monitor the distribution of request rates to tune limits appropriately
   - Build dashboards showing rate limit utilization across endpoints
   - Track legitimate users hitting limits (sign that limits may be too restrictive)
   - Implement logging for rate limit events with sufficient context for investigation

**Produce a rate limiting design document with algorithm choices per endpoint, configuration tables, Redis key schemas, implementation code patterns, and a monitoring plan.**
