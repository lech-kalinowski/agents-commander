---
name: Mutation Testing Review
description: Analyze code for mutation testing effectiveness, identify surviving mutants, and suggest tests that would detect untested behavioral changes.
category: testing
agents: [any]
panels: 1
---

Perform a mutation testing analysis to evaluate the effectiveness of the existing test suite. Identify behavioral changes that tests fail to detect and write tests to close those gaps.

## Step 1: Set Up Mutation Testing
- Identify the appropriate mutation testing tool for the project: Stryker for JS/TS, mutmut or cosmic-ray for Python, PIT for Java, go-mutesting for Go.
- Configure the tool to target the most critical source files (business logic, data processing, validation).
- If a mutation tool cannot be run directly, perform manual mutation analysis by reading the source code.

## Step 2: Identify Mutation Categories
Analyze the code for these common mutation points:

**Conditional Mutations**:
- Negating conditions: `if (x > 0)` becomes `if (x <= 0)`.
- Boundary shifts: `>=` becomes `>`, `<` becomes `<=`.
- Removing conditions entirely: `if (check)` becomes `if (true)`.

**Arithmetic Mutations**:
- Operator replacement: `+` becomes `-`, `*` becomes `/`.
- Constant replacement: `0` becomes `1`, `""` becomes `"mutant"`.
- Increment/decrement swaps: `++` becomes `--`.

**Logic Mutations**:
- AND/OR swaps: `&&` becomes `||`.
- Boolean literal flips: `true` becomes `false`.
- Removing negation: `!condition` becomes `condition`.

**Return Value Mutations**:
- Returning null instead of a value.
- Returning empty collection instead of populated one.
- Returning a different constant.

**Statement Mutations**:
- Removing function calls (especially side effects).
- Removing assignments.
- Removing exception throws.

## Step 3: Analyze Surviving Mutants
For each mutation that the existing tests do NOT detect:
- Explain what behavioral change the mutant introduces.
- Assess the risk: would this mutant cause a production bug?
- Determine why existing tests miss it (missing assertion, incomplete input coverage, testing only the happy path).

## Step 4: Write Mutant-Killing Tests
For each surviving mutant classified as medium or high risk:
- Write a targeted test that would fail if the mutation were applied.
- The test must assert the specific behavior that the mutation changes.
- Name the test to describe the behavior it protects (e.g., "should reject negative quantities in order total calculation").

## Step 5: Prioritization Framework
Rank surviving mutants by severity:
- **Critical**: Mutation in authentication, authorization, financial logic, or data integrity code.
- **High**: Mutation in validation, error handling, or core business rules.
- **Medium**: Mutation in utility functions, formatting, or logging.
- **Low**: Mutation in cosmetic or non-functional code.

## Step 6: Output Checklist
- [ ] All conditional boundaries in critical code have tests on both sides.
- [ ] Boolean logic changes are detected by at least one test.
- [ ] Return value mutations are caught by explicit assertions.
- [ ] Side-effect removals are detected by mock verification or state checks.
- [ ] Each new test is named to describe the specific behavior it guards.
- [ ] Surviving low-risk mutants are documented with justification for not testing.

Deliver a report of surviving mutants ranked by severity, alongside the new test files that kill the critical and high-priority ones.
