---
name: Monitoring and Alerting Setup
description: Design monitoring and alerting. Define SLIs/SLOs, create dashboards for golden signals (latency, traffic, errors, saturation), set up alerting rules, runbook links, escalation policies.
category: devops
agents: [any]
panels: 1
---

Design a comprehensive monitoring and alerting setup for this project. Cover observability across all layers from infrastructure to application.

## Step 1: Define Service Level Indicators (SLIs)
- Identify the critical user journeys and system operations.
- Define measurable SLIs for each: availability (success rate), latency (p50, p95, p99), throughput, and correctness.
- Map each SLI to a concrete metric source (application logs, APM traces, infrastructure metrics).
- Ensure SLIs reflect the user experience, not just internal system health.

## Step 2: Set Service Level Objectives (SLOs)
- Define target SLOs for each SLI (e.g., 99.9% availability, p99 latency under 500ms).
- Calculate error budgets based on SLOs (e.g., 99.9% allows 43.2 minutes downtime per month).
- Define burn rate thresholds that trigger alerts before the error budget is exhausted.
- Document the SLO review cadence and adjustment process.

## Step 3: Golden Signals Dashboard
Design dashboards covering the four golden signals for each service:
- **Latency**: Request duration histograms, p50/p95/p99 time series, slow endpoint breakdown.
- **Traffic**: Requests per second, concurrent users, throughput by endpoint and method.
- **Errors**: Error rate by type (4xx, 5xx, timeouts), error budget consumption rate.
- **Saturation**: CPU usage, memory usage, disk I/O, connection pool utilization, queue depth.

Include time range selectors, environment filters, and drill-down capabilities.

## Step 4: Alerting Rules
Define alerts at multiple severity levels:
- **Critical (page)**: SLO burn rate exceeds threshold, service down, data loss risk, security breach indicators.
- **Warning (notify)**: Elevated error rates, resource usage approaching limits, degraded performance.
- **Info (log)**: Deployment events, scaling events, configuration changes, certificate expiry approaching.

For each alert specify:
- The metric query and threshold with appropriate window size.
- Dampening period to avoid flapping (e.g., "firing for 5 minutes").
- Clear conditions and auto-resolve behavior.

## Step 5: Runbooks and Escalation
- Link every critical and warning alert to a runbook documenting diagnosis steps and remediation.
- Define escalation policies: who gets paged first, escalation timeouts, backup on-call rotation.
- Include automated remediation where safe (restart crashed services, scale up on saturation).
- Document communication templates for stakeholder updates during incidents.

## Step 6: Implementation
- Provide configuration for the monitoring stack in use (Prometheus, Grafana, Datadog, CloudWatch, or equivalent).
- Include metric instrumentation code for application-level metrics (counters, histograms, gauges).
- Set up structured logging with correlation IDs for distributed tracing.
- Add health check endpoints that monitoring can poll.

Output the monitoring configuration files, dashboard JSON definitions, and alerting rule definitions ready for deployment.
