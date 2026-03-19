---
name: Load Test Design
description: Design load testing scenarios with user patterns, throughput requirements, ramp-up strategies, success criteria, and bottleneck identification.
category: testing
agents: [any]
panels: 1
---

Design a comprehensive load testing strategy for the application. Define realistic traffic patterns, success criteria, and analysis procedures.

## Step 1: Identify Load Test Targets
- Review the application architecture to identify all endpoints and services that handle user traffic.
- Classify endpoints by expected load: high-traffic (listing pages, search, health checks), medium (CRUD operations), low (admin, reporting).
- Identify shared resources that may become bottlenecks: database connection pools, external API rate limits, file storage, in-memory caches, message queues.
- Document current production traffic patterns if available (peak hours, average RPS, concurrent users).

## Step 2: Define User Scenarios
Create realistic user behavior models:
- **Browse scenario**: User loads pages, scrolls, clicks links with think time between actions (simulates 70% of traffic).
- **Transaction scenario**: User performs a complete workflow (login, search, select, purchase/submit) representing 25% of traffic.
- **Power user scenario**: Rapid API calls, bulk operations, large file uploads representing 5% of traffic.

For each scenario specify:
- Exact sequence of HTTP requests with realistic headers and payloads.
- Think time distribution between requests (normal distribution, 2-5 seconds typical).
- Session duration and repeat patterns.
- Authentication flow (login once, reuse token).

## Step 3: Define Load Profiles
Design multiple test profiles:
- **Baseline**: Normal expected traffic (e.g., 100 concurrent users, 50 RPS) for 10 minutes to establish performance baseline.
- **Peak load**: Maximum expected traffic (e.g., 500 concurrent users, 200 RPS) sustained for 30 minutes to verify the system handles peak.
- **Stress test**: Gradually increase beyond peak until errors appear to find the breaking point.
- **Soak test**: Moderate load (80% of peak) sustained for 2-4 hours to detect memory leaks, connection exhaustion, and resource degradation.
- **Spike test**: Sudden traffic surge (0 to peak in 30 seconds) to test auto-scaling and graceful handling.

For each profile define:
- Ramp-up duration and pattern (linear, step, exponential).
- Steady-state duration.
- Ramp-down duration.
- Total virtual user count over time.

## Step 4: Define Success Criteria
Establish measurable thresholds:
- **Response time**: P50 under 200ms, P95 under 1 second, P99 under 3 seconds.
- **Error rate**: Less than 0.1% of requests return 5xx errors under peak load.
- **Throughput**: System sustains the target RPS without degradation.
- **Resource utilization**: CPU under 70%, memory under 80%, disk I/O under 60% at peak.
- **Connection metrics**: No connection timeouts, no pool exhaustion.
- **Recovery**: After spike, response times return to baseline within 60 seconds.

## Step 5: Write Load Test Scripts
- Use the appropriate tool: k6 for scripting-friendly HTTP tests, Locust for Python-based scenarios, Gatling for JVM projects, Artillery for Node.js projects.
- Parameterize test data (user credentials, search terms, product IDs) to avoid caching skew.
- Include proper correlation (extract tokens, IDs from responses for subsequent requests).
- Add checks/assertions within the script to catch functional errors during load.

## Step 6: Analysis and Reporting Plan
After each test run, collect and analyze:
- Response time percentiles (P50, P90, P95, P99) over time.
- Error rate by endpoint and error type.
- Throughput (successful requests per second) over time.
- Server-side metrics: CPU, memory, disk, network, connection pool usage.
- Database metrics: query latency, lock contention, slow queries.
- Correlation between load increase and performance degradation.

## Step 7: Deliverables Checklist
- [ ] User scenarios documented with realistic traffic distribution.
- [ ] Load profiles defined for baseline, peak, stress, soak, and spike.
- [ ] Success criteria specified with measurable thresholds.
- [ ] Test scripts written and parameterized for the chosen tool.
- [ ] Test data prepared with sufficient volume and variety.
- [ ] Monitoring dashboards configured for real-time observation.
- [ ] Analysis template ready for post-test reporting.

Deliver runnable load test scripts, configuration files, and a test plan document.
