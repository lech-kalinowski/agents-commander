---
name: Flaky Test Diagnosis
description: Diagnose and fix flaky tests. Check for timing dependencies, shared state, order-dependent tests, network calls, file system races, timezone issues, random data without seeding.
category: debugging
agents: [any]
panels: 1
---

Diagnose and fix flaky tests in this project. Identify the sources of non-determinism and make tests reliable.

## Step 1: Identify Flaky Tests
- Review test results history for tests that intermittently pass and fail without code changes.
- Run the full test suite multiple times (at least 5 runs) to identify tests with inconsistent results.
- Run suspicious tests in isolation vs. in the full suite to detect order-dependent failures.
- Check CI logs for tests that fail on specific platforms, runner types, or at specific times of day.
- Categorize flaky tests by their failure pattern: always fails in CI, fails on retry, fails intermittently.

## Step 2: Timing Dependencies
- Search for `setTimeout`, `setInterval`, `sleep`, and arbitrary delay-based assertions.
- Replace fixed delays with polling, event-based waiting, or retry-with-timeout patterns.
- Check for tests that depend on execution speed (asserting timestamps, measuring elapsed time).
- Look for race conditions between test setup and assertion (async operations completing before checks run).
- Verify that test timeouts are generous enough for slow CI environments but not so long they mask real issues.

## Step 3: Shared State
- Check for global variables, singletons, or module-level state modified by tests without cleanup.
- Verify each test's setup and teardown properly isolates state (database tables, files, caches, environment variables).
- Look for tests that depend on a specific database state left by a previous test.
- Check for shared test fixtures that are mutated instead of copied.
- Verify that mocks and stubs are restored after each test (sinon.restore, jest.restoreAllMocks).

## Step 4: External Dependencies
- Find tests that make real network calls to external APIs, databases, or services.
- Check for file system operations that conflict when tests run in parallel (same temp file paths).
- Look for port conflicts when tests start servers on hardcoded ports.
- Verify that tests using Docker containers or external processes properly wait for readiness.
- Replace external dependencies with deterministic mocks, stubs, or in-memory alternatives.

## Step 5: Non-Deterministic Data
- Check for tests that use `Math.random()`, `Date.now()`, or `new Date()` without controlling the value.
- Look for random test data generators without seeded randomness.
- Verify that tests involving UUIDs, auto-increment IDs, or hash values do not depend on specific values.
- Check for timezone sensitivity: tests that pass in one timezone but fail in another.
- Look for locale-dependent string comparisons, date formatting, or number formatting.

## Step 6: Order Dependencies
- Run tests in reverse order and random order to expose ordering assumptions.
- Check for tests that rely on auto-increment IDs matching specific values.
- Look for database tests that assume an empty database but do not truncate tables in setup.
- Verify that test suites can run in parallel without interfering with each other.
- Check for tests that modify environment variables without restoring them.

## Step 7: Fix and Verify
For each flaky test found:
- Identify the specific source of non-determinism.
- Apply the fix: deterministic mocks, proper isolation, controlled timing, seeded randomness.
- Run the fixed test at least 10 times to verify it is now reliable.
- Add a comment explaining what was flaky and why the fix works.
- Consider adding a CI job that runs the test suite multiple times to catch future flakiness.
