---
name: Property-Based Testing
description: Design property-based tests that verify invariants hold across random inputs, identifying properties like idempotency, commutativity, and round-trip encoding.
category: testing
agents: [any]
panels: 1
---

Design and implement property-based tests that verify universal invariants of the code rather than specific input-output examples. Follow this methodology:

## Step 1: Identify Testable Properties
Analyze the codebase and identify functions or modules where these property categories apply:

**Algebraic Properties**:
- **Idempotency**: Applying the operation twice yields the same result as once (e.g., formatting, normalization, deduplication).
- **Commutativity**: Order of inputs does not affect the result (e.g., set operations, merge functions).
- **Associativity**: Grouping of operations does not affect the result (e.g., string concatenation, list flattening).
- **Identity element**: There exists an input that leaves the result unchanged (e.g., adding zero, merging empty object).

**Round-Trip Properties**:
- **Encode/decode**: serialize then deserialize returns the original value.
- **Parse/format**: parsing a formatted value returns the original.
- **Compress/decompress**: data survives the round trip intact.

**Invariant Properties**:
- **Size preservation**: Output length relates predictably to input length.
- **Ordering preservation**: Sorted input produces sorted output.
- **Type preservation**: Output type matches the expected type for all inputs.
- **Range constraints**: Output values stay within defined bounds.

**Model-Based Properties**:
- Compare the implementation against a simpler reference model.
- Verify that an optimized path produces the same result as a naive path.

## Step 2: Define Input Generators
For each property test:
- Define custom generators for domain-specific types (valid email addresses, date ranges, nested objects).
- Include edge case generators: empty strings, zero-length arrays, negative numbers, unicode characters, very large inputs.
- Use shrinking strategies so that failing cases are reduced to minimal reproducible examples.
- Constrain generators to produce only valid inputs when testing behavior (not validation).

## Step 3: Write Property Tests
For each identified property:
- State the property as a clear, concise assertion in the test name (e.g., "encoding then decoding any valid message returns the original message").
- Generate at least 100 random inputs per property (configurable).
- Assert the property holds for every generated input.
- Include a seed value for reproducibility of any failing case.

## Step 4: Framework Setup
- Use the appropriate property-based testing library: fast-check for JS/TS, Hypothesis for Python, QuickCheck/hedgehog for Haskell, gopter for Go, jqwik for Java.
- Configure the number of test iterations, shrink attempts, and random seed.
- Integrate with the existing test runner so property tests run alongside unit tests.

## Step 5: Quality Checklist
- [ ] Each property is stated as a universal law, not a specific example.
- [ ] Input generators cover the full domain including edge cases.
- [ ] Failing cases are automatically shrunk to minimal examples.
- [ ] Tests are reproducible via seed values.
- [ ] Custom generators are reusable across multiple property tests.
- [ ] Properties are independent and test distinct invariants.
- [ ] Test execution time is reasonable (under 30 seconds per property).

Run all property tests and report any discovered violations with their minimal failing inputs.
