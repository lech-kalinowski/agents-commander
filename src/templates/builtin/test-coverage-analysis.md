---
name: Test Coverage Analysis
description: Analyze existing test coverage, identify gaps in critical code paths, and generate targeted tests for uncovered logic.
category: testing
agents: [any]
panels: 1
---

Perform a thorough test coverage analysis and fill identified gaps with targeted tests. Follow this process:

## Step 1: Generate Coverage Report
- Run the existing test suite with coverage instrumentation enabled.
- Use the project's configured coverage tool, or set one up if missing (istanbul/nyc for JS/TS, coverage.py for Python, JaCoCo for Java, go test -cover for Go).
- Generate both summary and detailed per-file reports.
- Identify the overall line, branch, function, and statement coverage percentages.

## Step 2: Identify Coverage Gaps
Analyze the coverage report and categorize uncovered code by risk level:

**Critical (must cover)**:
- Business logic functions with zero or partial coverage.
- Error handling blocks (catch clauses, error callbacks, fallback paths).
- Authentication and authorization checks.
- Data validation and sanitization logic.
- Financial calculations or data transformation pipelines.

**High priority**:
- Conditional branches where only one path is tested.
- Default/else branches in switch statements.
- Edge case handling code (empty inputs, overflow, null checks).
- Retry and timeout logic.

**Medium priority**:
- Utility and helper functions.
- Logging and monitoring code paths.
- Configuration parsing and defaults.

## Step 3: Analyze Untested Branches
For each uncovered branch:
- Determine what input or state would trigger execution of that branch.
- Check if the branch is dead code (unreachable). If so, flag it for removal rather than testing.
- Identify if the branch requires specific mock setup (error injection, timeout simulation).

## Step 4: Generate Gap-Filling Tests
Write tests specifically targeting uncovered code paths:
- One test per uncovered branch or code path.
- Name each test to describe the specific gap it fills (e.g., "should handle database connection timeout").
- Use the AAA pattern (Arrange, Act, Assert).
- Ensure tests verify behavior, not just that the code executes (assert outcomes, not just coverage).

## Step 5: Validate Improvement
- Re-run the test suite with coverage to confirm gaps are filled.
- Report before and after coverage percentages for each metric.
- List any remaining uncovered paths with justification (dead code, platform-specific, etc.).

## Step 6: Output Checklist
- [ ] Coverage report generated and analyzed for all source files.
- [ ] Critical business logic has at least 90% branch coverage.
- [ ] Error handlers and catch blocks are explicitly tested.
- [ ] All new tests verify behavior, not just execution.
- [ ] Dead code is flagged for removal with reasoning.
- [ ] Before/after coverage comparison is documented.
- [ ] No existing tests were broken by the additions.

Deliver the new test files alongside a summary of coverage improvements per module.
