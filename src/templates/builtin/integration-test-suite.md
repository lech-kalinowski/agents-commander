---
name: Integration Test Suite
description: Design and write integration tests verifying component interactions, API contracts, database operations, and external service integration.
category: testing
agents: [any]
panels: 1
---

Design and implement an integration test suite that verifies how components work together in the system. Follow this methodology:

## Step 1: Dependency Mapping
- Identify all integration boundaries in the codebase: module-to-module calls, database queries, API endpoints, message queues, file I/O, and external service calls.
- Draw a dependency graph of the components under test.
- Classify each boundary as internal (testable directly) or external (needs a test double).

## Step 2: Test Environment Setup
- Define setup and teardown procedures that guarantee test isolation.
- For database tests: use transactions that roll back after each test, or a dedicated test database with migration scripts.
- For API tests: set up an in-process test server or use the framework's built-in test client.
- For external services: use recorded fixtures (VCR pattern), contract stubs, or in-memory fakes.
- Document all environment variables and configuration needed to run the integration tests.

## Step 3: Test Scenario Design
For each integration boundary, create tests covering:
- **Successful interactions**: Data flows correctly between components end-to-end.
- **Contract verification**: Request and response shapes match expected schemas.
- **Error propagation**: Errors from downstream components are handled and surfaced correctly.
- **Timeout and retry behavior**: Components behave correctly under latency or transient failures.
- **Data consistency**: After a sequence of operations, the system state is consistent.
- **Concurrency**: Multiple simultaneous operations do not corrupt shared state.

## Step 4: Write Tests with Proper Isolation
- Each test must set up its own preconditions and clean up after itself.
- Use factory functions or fixtures for test data, never hardcoded IDs or values that depend on database state.
- Tag or separate integration tests from unit tests so they can be run independently.
- Keep each test focused on one integration path; avoid testing multiple boundaries in a single test.

## Step 5: Quality Checklist
- [ ] Tests can run in any order without affecting each other.
- [ ] Tests do not depend on data created by other tests.
- [ ] External service calls use deterministic test doubles, not live services.
- [ ] Database state is reset between tests (transaction rollback or truncation).
- [ ] Test names describe the integration scenario, not implementation details.
- [ ] Slow or flaky operations have appropriate timeouts configured.
- [ ] All setup/teardown hooks are symmetric (everything created is cleaned up).

## Step 6: Execution and Validation
- Run the full integration test suite and verify all tests pass.
- Confirm tests fail correctly when the integration contract is intentionally broken.
- Measure execution time and flag any tests taking longer than 5 seconds for optimization.

Output complete, runnable test files organized by integration boundary.
