---
name: Frontend Error Handling
description: Implement frontend error handling: error boundaries, network error recovery, retry logic, user-friendly error messages, error reporting to monitoring, graceful degradation, offline indicators.
category: frontend
agents: [any]
panels: 1
---
You are a frontend reliability engineer. Design and implement a comprehensive error handling strategy for this project.

**Address each of the following areas:**

1. **Error Boundaries**
   - Implement error boundaries at strategic levels: app root, route level, and feature level
   - Design fallback UIs that are helpful, not just "Something went wrong"
   - Include recovery actions in fallback UIs (retry button, navigation to home, refresh)
   - Ensure error boundaries log caught errors to your monitoring system
   - Prevent a single component failure from crashing the entire application

2. **Network Error Recovery**
   - Categorize network errors: timeout, offline, server error (5xx), client error (4xx), CORS
   - Implement automatic retry with exponential backoff for transient failures (timeouts, 5xx)
   - Set reasonable timeout values for different types of requests
   - Handle request cancellation on component unmount to prevent state updates on unmounted components
   - Detect online/offline status and pause requests when offline

3. **Retry Logic**
   - Implement configurable retry policies: max attempts, backoff strategy, jitter
   - Only retry idempotent operations automatically (GET requests, not POST/PUT)
   - Provide manual retry affordances for non-idempotent operations
   - Show retry progress to the user (attempt 2 of 3, retrying in 5s...)
   - Circuit-break after repeated failures to avoid hammering a down service

4. **User-Friendly Error Messages**
   - Map technical errors to human-readable messages with clear next steps
   - Avoid exposing stack traces, error codes, or internal details to end users
   - Provide context-specific messages ("Could not save your draft" not "Network Error")
   - Include actionable guidance: what to do next, who to contact for help
   - Support localization of error messages

5. **Error Reporting and Monitoring**
   - Integrate with an error monitoring service (Sentry, Datadog, Bugsnag, etc.)
   - Capture breadcrumbs: user actions leading up to the error
   - Include relevant context: user ID, session ID, route, component stack
   - Set up source maps for readable stack traces in production
   - Deduplicate errors and set up alerts for new or spiking error patterns
   - Filter out noise: browser extensions, bot errors, known third-party issues

6. **Graceful Degradation**
   - Identify critical vs non-critical features and handle their failures differently
   - If a non-critical feature fails (analytics, recommendations), hide it silently
   - If a critical feature fails (auth, checkout), show clear error with recovery path
   - Implement feature flags to disable problematic features without deployment
   - Provide read-only or cached versions of content when write operations fail

7. **Offline Indicators and Handling**
   - Detect connectivity changes using navigator.onLine and online/offline events
   - Show a persistent but non-intrusive offline banner
   - Queue user actions taken while offline and sync when reconnected
   - Clearly indicate which features are available offline vs require connectivity
   - Handle the transition back to online state gracefully (sync, refresh stale data)

**Produce an error handling architecture document with code patterns for each category, integration points with the existing codebase, and a testing strategy for simulating error conditions.**
