---
name: Unit Test Generation
description: Generate comprehensive unit tests for existing code covering happy paths, edge cases, error conditions, and boundary values using the AAA pattern.
category: testing
agents: [any]
panels: 1
---

Analyze the provided source code and generate a comprehensive unit test suite. Follow these steps methodically:

## Step 1: Code Analysis
- Read all source files in the target module or directory.
- Identify every public function, method, class, and exported interface.
- Map out each code path including conditional branches, loops, early returns, and error throws.
- Note all dependencies that will need mocking or stubbing.

## Step 2: Test Case Design
For each function or method, design test cases covering these categories:
- **Happy path**: Normal expected inputs producing expected outputs.
- **Edge cases**: Empty strings, empty arrays, zero values, single-element collections, maximum-length inputs.
- **Boundary values**: Off-by-one scenarios, min/max integer values, threshold values for conditionals.
- **Error conditions**: Invalid inputs, null/undefined arguments, type mismatches, thrown exceptions.
- **State transitions**: If the function modifies state, test before and after states.

## Step 3: Write Tests Using AAA Pattern
Structure every test with clearly separated sections:
1. **Arrange** - Set up test data, mocks, stubs, and preconditions.
2. **Act** - Call the function or method under test exactly once.
3. **Assert** - Verify the result, side effects, and mock interactions.

## Step 4: Test Quality Checklist
Verify each test meets these criteria:
- [ ] Test description reads as documentation (e.g., "should return empty array when input list is empty").
- [ ] Each test verifies exactly one behavior.
- [ ] Tests are independent and can run in any order.
- [ ] No test depends on external state, network, or file system.
- [ ] Mocks are minimal - only mock direct dependencies, not transitive ones.
- [ ] Assertion messages are descriptive enough to diagnose failures without reading test code.
- [ ] Negative tests verify both the error type and the error message.

## Step 5: Output Format
- Use the testing framework already present in the project (detect from package.json or existing tests).
- Match the naming conventions and file structure of existing tests.
- Group related tests using describe/context blocks with meaningful names.
- Include a brief comment at the top of each test file listing what module it covers.
- If no testing framework is detected, use the most common one for the language (Jest for JS/TS, pytest for Python, JUnit for Java, Go testing for Go).

Generate the complete test files ready to run. After writing, execute the test suite to confirm all tests pass.
