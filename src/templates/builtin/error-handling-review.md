---
name: Error Handling Review
description: Audit error handling patterns for consistency, correctness, and security across the codebase.
category: code-quality
agents: [any]
panels: 1
---
Conduct a thorough audit of error handling practices across this codebase. Identify anti-patterns, gaps, and inconsistencies, then recommend a unified error handling strategy.

## Error Handling Anti-Patterns to Detect

1. **Swallowed Exceptions** - Empty catch blocks, catch blocks that only log but do not rethrow or handle meaningfully, and catch blocks that silently return default values without logging.
2. **Generic Catches** - Catch blocks that catch the base Exception/Error type without distinguishing between recoverable and unrecoverable errors. Look for `catch (e)` or `catch (error: any)` without type narrowing.
3. **Missing Error Types** - Code that throws plain strings, generic Error objects, or untyped objects instead of domain-specific error classes with proper error codes.
4. **Inconsistent Error Formats** - Different modules returning errors in different shapes (some use error/string objects, others use message/code objects, others throw). Map all error formats found.
5. **Unhandled Promise Rejections** - Async functions without catch handlers, missing await keywords, fire-and-forget promises, event emitter error events without listeners.
6. **Missing Try-Catch** - I/O operations (file reads, network calls, JSON parsing, database queries) that are not wrapped in error handling.
7. **Error Messages Leaking Internals** - Error messages that expose file paths, stack traces, database schemas, internal IPs, or other sensitive information to end users.
8. **Incorrect Error Propagation** - Errors that are caught and rethrown without preserving the original stack trace or cause chain.
9. **Inconsistent Error Logging** - Some errors logged with full context, others with just a message, others not logged at all.
10. **Missing Cleanup on Error** - Resources (file handles, connections, streams) not properly cleaned up in error paths. Missing finally blocks or equivalent patterns.

## Analysis Methodology

- Scan all source files for try/catch blocks, .catch() calls, error event handlers, and throw statements.
- Trace error propagation paths from origin to final handler for key code paths.
- Identify all async operations and verify each has proper error handling.
- Catalog all custom error types and where they are used.
- Check boundary layers (API handlers, CLI entry points, event listeners) for proper error boundaries.

## Output Format

### Critical Issues (can cause crashes, data loss, or security problems)
For each: file path, line range, issue type, description, and fix with code example.

### Consistency Issues (different patterns across modules)
- Map of error handling patterns found across the codebase.
- Recommended unified pattern with code examples.

### Missing Error Handling
List of locations where error handling is absent but should be present, with the specific risk involved.

### Error Type Inventory
- All custom error types and where they are defined.
- Gaps: which error scenarios lack a dedicated type.
- Proposed error type hierarchy.

### Recommendations
1. Proposed error handling conventions for the project (with code templates).
2. Error boundary strategy (where to catch, where to propagate).
3. Error logging standards (what context to include, what to redact).
4. Unhandled rejection and uncaught exception strategy.
5. Specific code changes to make, ordered by risk reduction.
