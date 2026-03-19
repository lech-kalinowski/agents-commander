---
name: Resilience Patterns
description: Implement resilience patterns including circuit breakers, retry strategies, bulkheads, timeouts, fallbacks, health checks, and graceful degradation.
category: architecture
agents: [any]
panels: 1
---
Analyze this application for failure modes and design a comprehensive resilience strategy. Identify vulnerabilities and implement patterns to handle failures gracefully.

## Step 1: Failure Mode Analysis
- Inventory all external dependencies: databases, APIs, message brokers, file systems, third-party services, DNS, authentication providers.
- For each dependency, identify failure modes:
  - **Unavailability**: The dependency is completely down.
  - **Degraded performance**: Responses are slow but eventually arrive.
  - **Partial failure**: Some requests succeed, others fail unpredictably.
  - **Data corruption**: The dependency returns incorrect or malformed data.
  - **Cascading failure**: One dependency's failure causes others to fail (e.g., thread pool exhaustion spreading across services).
- Map the blast radius of each failure: what functionality is lost, what user-facing impact occurs, and what downstream systems are affected.

## Step 2: Circuit Breaker Implementation
For each external dependency:
- Define the circuit breaker states: **Closed** (normal operation), **Open** (requests fail immediately), **Half-Open** (testing recovery).
- Configure thresholds: failure count or failure rate to trip open, success count in half-open to close, timeout duration before transitioning from open to half-open.
- Design the fallback behavior when the circuit is open: return cached data, default values, degraded functionality, or an informative error.
- Implement monitoring: track circuit state transitions, failure rates, and recovery times. Alert on circuits that remain open beyond expected recovery time.

## Step 3: Retry Strategy Design
For each retryable operation:
- Classify errors: **Transient** (network timeout, 503, connection reset — retry) vs. **Permanent** (400, 404, authentication failure — do not retry).
- Configure retry policy:
  - Maximum retry count (typically 3-5).
  - Backoff strategy: exponential backoff with jitter (e.g., base 200ms, factor 2, jitter +/- 50%) to prevent thundering herd.
  - Retry budget: limit total retries across all requests to prevent retry storms (e.g., max 20% of requests can be retries).
- Ensure idempotency: retried operations must produce the same result. Use idempotency keys for non-idempotent operations (POST requests, payment processing).

## Step 4: Bulkhead and Isolation Patterns
- Identify shared resources that could become contention points: thread pools, connection pools, memory, CPU.
- Design bulkheads to isolate failures:
  - Separate connection pools per external dependency so one slow service cannot exhaust connections for others.
  - Separate thread pools or worker queues for critical vs. non-critical operations.
  - Rate limit individual consumers to prevent one bad actor from degrading service for others.
- Implement timeouts at every integration point:
  - Connection timeout: how long to wait to establish a connection (typically 1-5 seconds).
  - Read/response timeout: how long to wait for a response (varies by operation, typically 5-30 seconds).
  - Overall operation timeout: end-to-end deadline including retries.

## Step 5: Health Checks and Graceful Degradation
- Design health check endpoints:
  - **Liveness**: Is the process running? (simple, always returns 200 if the app responds).
  - **Readiness**: Can the service handle requests? (checks database connectivity, cache availability, critical dependency status).
  - **Dependency health**: Individual health status for each external dependency.
- Design graceful degradation tiers:
  - **Tier 1 (fully operational)**: All features available, all dependencies healthy.
  - **Tier 2 (degraded)**: Core features available, non-critical features disabled (e.g., recommendations off, analytics deferred).
  - **Tier 3 (minimal)**: Only essential read operations, all writes queued for later processing.
  - **Tier 4 (maintenance)**: Static error page with status information.
- Implement feature flags to toggle degradation tiers manually or automatically based on health checks.

## Step 6: Deliverables
1. **Failure mode catalog**: Every dependency with its failure modes, probability, blast radius, and current mitigation (or lack thereof).
2. **Resilience pattern assignments**: Which patterns apply to each dependency and integration point, with specific configuration values.
3. **Implementation code**: Circuit breaker, retry, timeout, and bulkhead implementations or library configurations for the project's tech stack.
4. **Degradation playbook**: For each failure scenario, the expected system behavior, user experience, and recovery procedure.
5. **Testing plan**: Chaos engineering approach — how to simulate each failure mode (network partitions, latency injection, dependency shutdown) and verify resilience behavior.
6. **Monitoring dashboard**: Metrics to track (circuit breaker states, retry rates, timeout frequency, degradation tier) with alerting thresholds.
