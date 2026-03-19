---
name: Test Refactoring
description: Refactor existing tests to improve maintainability by extracting helpers, reducing duplication, improving assertions, and fixing flaky tests.
category: testing
agents: [any]
panels: 1
---

Analyze and refactor the existing test suite to improve maintainability, readability, and reliability. Follow this systematic process:

## Step 1: Test Suite Assessment
Read through all existing test files and evaluate:
- **Duplication**: Identify repeated setup code, assertion patterns, and test data across files.
- **Readability**: Flag tests with unclear names, missing descriptions, or no comments explaining complex setup.
- **Reliability**: Identify flaky tests (timing-dependent, order-dependent, or environment-dependent).
- **Structure**: Check for overly large test files, deeply nested describe blocks, or inconsistent organization.
- **Coverage gaps**: Note any tests that assert trivial things while missing important behaviors.

## Step 2: Extract Test Helpers and Utilities
- Create shared factory functions for commonly constructed test objects (users, orders, requests).
- Extract repeated setup sequences into reusable beforeEach helpers or fixture functions.
- Build custom assertion helpers for domain-specific checks (e.g., `expectValidResponse(res)` instead of repeating 5 assertions).
- Create mock builders that return pre-configured mocks with sensible defaults and chainable overrides.

## Step 3: Improve Test Descriptions
Rewrite test names to follow the pattern: "should [expected behavior] when [condition]".
- Bad: "test1", "works correctly", "handles error".
- Good: "should return 404 when resource does not exist", "should retry failed requests up to 3 times".
- Ensure describe block names identify the unit under test and the context.

## Step 4: Fix Flaky Tests
For each identified flaky test:
- **Timing issues**: Replace setTimeout/sleep with event-driven waits or mocked timers.
- **Order dependence**: Ensure each test creates and tears down its own state.
- **Shared mutable state**: Isolate state per test using beforeEach resets.
- **Network dependence**: Replace real HTTP calls with deterministic mocks.
- **Date/time dependence**: Mock Date.now() or use a clock library.

## Step 5: Improve Assertion Quality
- Replace generic assertions (`toBeTruthy`, `not.toBeNull`) with specific ones (`toBe`, `toEqual`, `toContain`).
- Add custom error messages to assertions that would otherwise produce opaque failures.
- Use asymmetric matchers for partial object matching instead of asserting every field.
- Verify negative cases explicitly (ensure something does NOT happen, not just that something does).

## Step 6: Structural Improvements
- Split large test files (over 300 lines) into focused files by feature or function.
- Flatten unnecessary nesting (no more than 3 levels of describe).
- Group tests logically: success cases first, then error cases, then edge cases.
- Remove commented-out tests: either fix and enable them, or delete them.
- Remove tests that duplicate coverage without adding value.

## Step 7: Refactoring Checklist
- [ ] No test file has more than 300 lines.
- [ ] No setup code is duplicated across more than 2 tests.
- [ ] Every test has a descriptive name following "should...when..." pattern.
- [ ] All flaky tests are fixed or quarantined with a tracking issue.
- [ ] Custom assertion helpers exist for repeated domain assertions.
- [ ] Test data factories replace inline object construction.
- [ ] All tests pass after refactoring with no behavior changes.
- [ ] Test count remains the same or increases (refactoring must not delete coverage).

Run the full test suite before and after refactoring to confirm no regressions. Report the improvements made.
