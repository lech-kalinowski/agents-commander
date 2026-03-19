---
name: E2E Test Scenarios
description: Create end-to-end test scenarios covering critical user journeys with test data, expected flows, assertions, and common failure modes.
category: testing
agents: [any]
panels: 1
---

Design and implement end-to-end tests that validate complete user journeys through the application. Follow this structured approach:

## Step 1: Identify Critical User Journeys
- Review the application to understand the core workflows users perform.
- Prioritize journeys by business impact: authentication, primary CRUD operations, payment flows, data export, onboarding sequences.
- For each journey, document the entry point, the sequence of actions, and the expected final state.
- Identify shared preconditions (logged-in user, seeded data, specific feature flags).

## Step 2: Define Test Data Requirements
- Specify the exact data state needed before each test: user accounts, database records, configuration.
- Create seed scripts or fixture files that produce a known, repeatable starting state.
- Handle dynamic values explicitly: generate unique emails with timestamps, use deterministic IDs where possible.
- Define cleanup procedures to reset state after test completion.

## Step 3: Write Test Scenarios
For each user journey, structure the test as:
1. **Preconditions**: State the required setup (user role, data, feature flags).
2. **Steps**: List every user action in order (navigate, click, type, submit, wait).
3. **Checkpoints**: After each significant step, assert visible state (UI text, URL, element presence).
4. **Final assertion**: Verify the end state both in the UI and in the backend (database, API response).

Cover these scenario types for each journey:
- **Happy path**: Standard successful completion.
- **Validation errors**: Invalid input at each form step, verify error messages appear.
- **Interrupted flow**: User navigates away mid-flow and returns, browser refresh mid-form.
- **Permission boundaries**: Unauthorized users see appropriate access denied responses.
- **Concurrent usage**: Two users acting on the same resource simultaneously.

## Step 4: Handle Flakiness and Reliability
- Use explicit waits for asynchronous operations instead of fixed sleep timers.
- Retry transient failures (network blips) with a maximum retry count.
- Isolate tests from each other: each test creates its own user and data.
- Avoid CSS selector fragility by using data-testid attributes or accessible roles.
- Screenshot on failure for debugging.

## Step 5: Output Checklist
- [ ] Each test is independent and can run in isolation.
- [ ] Test names describe the user journey in plain language.
- [ ] No hardcoded waits; all waits are condition-based.
- [ ] Test data is created and destroyed within the test lifecycle.
- [ ] Assertions check both visible UI state and underlying data integrity.
- [ ] Failure messages include enough context to diagnose without re-running.
- [ ] Tests are tagged by feature area for selective execution.

## Step 6: Execution
- Run the full E2E suite and verify all scenarios pass.
- Confirm that each test fails correctly when the expected behavior is intentionally broken.
- Report execution time per scenario and total suite runtime.

Write complete, runnable E2E test files using the project's existing E2E framework (detect from config). If none exists, recommend and set up the most appropriate one for the stack.
