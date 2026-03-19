---
name: Error Log Analysis
description: Analyze error logs or stack traces to diagnose issues. Parse error patterns, identify root cause, trace through code paths, check for environmental factors, suggest fixes with confidence levels.
category: debugging
agents: [any]
panels: 1
---

Analyze the provided error logs or stack traces to diagnose the issue. Follow a structured approach from symptom to root cause.

## Step 1: Parse and Classify Errors
- Extract all unique error types, messages, and stack traces from the logs.
- Group errors by type and frequency. Identify the most common and the most recent errors.
- Classify each error: application error, infrastructure error, dependency error, user input error.
- Check timestamps for patterns: do errors cluster around specific times, deployments, or traffic spikes?
- Identify correlated errors that may share a common root cause.

## Step 2: Stack Trace Analysis
- For each distinct stack trace, identify the originating function and file.
- Trace the call chain from the top frame (where the error was thrown) down to the entry point.
- Read the code at each frame to understand the execution context and what went wrong.
- Check for error wrapping: find the original error if it was caught and re-thrown.
- Look for truncated or missing stack frames that indicate async boundary issues or error swallowing.

## Step 3: Code Path Investigation
- Navigate to the code location identified in the stack trace.
- Examine the function for potential failure causes: null references, type errors, missing validation, unhandled edge cases.
- Check the inputs to the function: what data could trigger this error?
- Review recent changes to this code path using git blame and git log.
- Check if the error handling in this path is correct (catching the right exception types, providing useful context).

## Step 4: Environmental Factors
- Check if the error correlates with specific environments (production only, certain regions, specific server instances).
- Look for resource exhaustion indicators: out of memory, connection pool exhausted, disk full, file descriptor limit.
- Check network-related factors: DNS resolution failures, connection timeouts, SSL certificate issues.
- Verify dependency availability: database connectivity, external API status, message queue health.
- Check for configuration differences between environments that could explain environment-specific errors.

## Step 5: Pattern Recognition
- Identify error patterns that suggest known issues:
  - Repeating at fixed intervals: likely a cron job or scheduled task.
  - Gradually increasing: resource leak or growing data volume.
  - Sudden spike: deployment, traffic surge, or dependency failure.
  - Intermittent: race condition, timeout, or flaky external dependency.
- Cross-reference error timestamps with deployment logs, infrastructure events, and external service status pages.

## Step 6: Diagnosis and Recommendations
For each identified issue, provide:
- **Root cause**: Clear explanation of why the error occurs.
- **Confidence level**: High (certain based on evidence), Medium (probable but needs verification), Low (hypothesis needing investigation).
- **Impact**: What functionality is affected, how many users are impacted.
- **Fix**: Specific code changes with file paths and line numbers.
- **Prevention**: How to prevent this class of error in the future (validation, monitoring, testing).
- **Monitoring**: What alert or metric would catch this issue earlier next time.

Prioritize findings by severity and confidence level. Provide actionable next steps for each.
