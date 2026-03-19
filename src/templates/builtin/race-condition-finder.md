---
name: Race Condition Finder
description: Find race conditions and concurrency bugs. Check shared mutable state, async operations without proper synchronization, TOCTOU vulnerabilities, database transaction isolation, UI state races.
category: debugging
agents: [any]
panels: 1
---

Analyze this project for race conditions, concurrency bugs, and timing-dependent issues that may cause intermittent failures.

## Step 1: Shared Mutable State
- Identify all shared mutable state: global variables, singleton state, class-level properties modified by multiple callers.
- Check for read-modify-write patterns that are not atomic (counter increments, balance updates, status transitions).
- Look for variables accessed across async boundaries without synchronization (locks, mutexes, atomic operations).
- In multi-threaded code, verify proper use of synchronization primitives (mutex, semaphore, read-write lock).
- In single-threaded async code (Node.js), check for state that changes between `await` points.

## Step 2: Async Operation Ordering
- Find operations that assume a specific execution order but use `Promise.all`, parallel async calls, or fire-and-forget patterns.
- Check for async initialization that may not complete before the resource is used.
- Look for event handlers that can fire in unexpected order (WebSocket messages, DOM events, file watchers).
- Verify that retry logic handles concurrent retries correctly (multiple retries for the same operation).
- Check for unhandled promise rejections that silently swallow errors in concurrent flows.

## Step 3: TOCTOU (Time of Check, Time of Use)
- Find patterns where a condition is checked and then acted upon without holding a lock (file exists then open, user has permission then execute).
- Check for database queries that read a value and then update based on the read without a transaction.
- Look for filesystem operations that check existence before create/delete without atomic alternatives.
- Identify optimistic concurrency patterns that lack proper conflict detection (missing version checks).
- Verify that API endpoints handle concurrent requests to the same resource safely.

## Step 4: Database Transaction Isolation
- Review database transactions for proper isolation levels.
- Check for lost updates: two transactions reading the same row, modifying it, and writing back.
- Look for phantom reads in queries that assume a consistent snapshot without proper isolation.
- Verify that multi-step database operations are wrapped in transactions, not executed as individual queries.
- Check for deadlocks caused by acquiring locks on multiple tables in different orders across transactions.

## Step 5: UI State Races
- Check for stale closures in React/Vue/Angular components that capture outdated state.
- Look for rapid user interactions (double-clicks, fast navigation) that trigger overlapping async operations.
- Verify that loading/error states handle concurrent requests correctly (cancel previous, ignore stale results).
- Check for optimistic UI updates that do not properly handle server-side rejection.
- Look for form submissions that do not disable the submit button during processing.

## Step 6: Verification Approach
- For each potential race condition found, describe the specific interleaving that triggers the bug.
- Provide a concrete scenario with timing (request A starts, request B starts, B finishes first, A overwrites).
- Recommend the appropriate fix: locking, atomic operations, idempotency, optimistic concurrency, request deduplication.
- Suggest tests that can expose the race condition (concurrent test runners, stress tests, artificial delays).
- Identify which races are theoretical vs. likely to occur in production given actual traffic patterns.

Report each finding with file path, code snippet, race scenario, severity, and recommended fix.
