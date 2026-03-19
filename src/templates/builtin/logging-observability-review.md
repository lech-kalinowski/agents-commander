---
name: Logging and Observability Review
description: Review logging practices, observability instrumentation, and operational readiness across the codebase.
category: code-quality
agents: [any]
panels: 1
---
Conduct a comprehensive review of logging and observability practices in this codebase. Assess whether the application provides sufficient visibility into its runtime behavior for debugging, monitoring, and incident response.

## Logging Review Checklist

### 1. Structured Logging
- Are log entries structured (JSON or key-value pairs) or free-form text strings?
- Is there a consistent log entry schema with fields like: timestamp, level, message, component, correlationId, metadata?
- Are log messages parameterized (e.g., `log.info("User created", { userId })`) rather than concatenated (e.g., `log.info("User created: " + userId)`)?
- Is a centralized logging utility used, or do modules log independently with inconsistent formats?

### 2. Log Levels
- Are log levels used correctly and consistently?
  - **ERROR**: Unrecoverable failures requiring attention.
  - **WARN**: Recoverable issues or unexpected conditions.
  - **INFO**: Significant business events and state transitions.
  - **DEBUG**: Detailed diagnostic information for development.
  - **TRACE**: Very detailed flow tracing (if applicable).
- Find misuses: errors logged as info, routine operations logged as warnings, debug information in production logs.
- Is the log level configurable at runtime or startup?

### 3. Correlation and Context
- Can a single request or operation be traced across all log entries it generates? Is a correlation ID or request ID propagated?
- Do log entries include sufficient context: which module, which function, which entity was being processed?
- For async operations: can you follow the chain of events across callbacks, promises, or event handlers?

### 4. Sensitive Data Protection
- Scan all log statements for potential PII leaks: emails, passwords, tokens, API keys, credit card numbers, IP addresses, session IDs.
- Are there scrubbing or redaction utilities applied before logging user data?
- Check that error stack traces do not expose sensitive file paths or internal architecture to external log aggregators.

### 5. Performance and Error Metrics
- Are key operations timed? Look for: request duration, database query time, external API call latency, file I/O duration.
- Are error rates tracked? Can you determine the error rate of each component from logs alone?
- Are business metrics logged? User actions, feature usage, conversion events?
- Is there any performance budgeting or SLI/SLO tracking in place?

### 6. Error Tracking
- Are unhandled exceptions and promise rejections captured and logged with full stack traces?
- Is there integration with an error tracking service (Sentry, Bugsnag, etc.) or is the codebase prepared for one?
- Are errors categorized by severity and component for triage?

### 7. Health Checks and Readiness
- Does the application expose health check endpoints or signals?
- Are dependency health checks included (database connectivity, external API availability)?
- Is there a readiness vs. liveness distinction for container/orchestration environments?

### 8. Distributed Tracing (if applicable)
- For multi-service architectures: are trace IDs propagated across service boundaries?
- Are spans created for significant operations within a service?
- Is there OpenTelemetry or equivalent instrumentation?

## Analysis Methodology

- Catalog every log statement in the codebase: file path, level, message pattern, and context fields included.
- Map which code paths produce no log output at all (silent failures or silent operations).
- Identify the logging library/framework in use and its configuration.
- Check for log output in error handlers, catch blocks, and boundary layers.

## Output Format

### Current State Assessment
- Logging library and configuration in use.
- Total log statements by level.
- Modules with no logging at all (blind spots).
- Modules with excessive logging (noise).

### Critical Gaps
Issues that would prevent effective debugging or incident response. For each: the gap, its impact, and the specific fix.

### Sensitive Data Exposure
Every instance where sensitive data might appear in logs. Severity and remediation for each.

### Observability Improvement Plan

**Immediate (Day 1):**
- Add logging to critical blind spots.
- Remove or redact sensitive data from existing log statements.
- Fix log level misuses.

**Short-Term (Week 1):**
- Implement structured logging format if not present.
- Add correlation ID propagation.
- Instrument key code paths with timing metrics.

**Medium-Term (Month 1):**
- Add health check endpoints.
- Integrate error tracking service.
- Establish log retention and rotation policy.
- Create operational runbooks referencing log patterns.

For each recommendation, provide the specific file and code changes needed.
