---
name: Complexity Reduction
description: Analyze cyclomatic and cognitive complexity, identify hot spots, and suggest decomposition strategies.
category: code-quality
agents: [any]
panels: 1
---
Perform a comprehensive complexity analysis of this codebase. Identify functions and modules that exceed acceptable complexity thresholds and provide actionable decomposition strategies.

## Complexity Metrics to Evaluate

1. **Cyclomatic Complexity** - Count independent paths through each function. Flag any function with cyclomatic complexity > 10. Functions > 20 are critical.
2. **Cognitive Complexity** - Assess how difficult each function is to understand by a human reader. Flag functions with cognitive complexity > 15. Account for nesting depth, breaks in linear flow, and mental model switches.
3. **Nesting Depth** - Identify code with nesting deeper than 3 levels. Each additional level significantly increases cognitive load.
4. **Function Length** - Flag functions exceeding 40 lines of logic (excluding comments and blank lines).
5. **Parameter Count** - Flag functions with more than 4 parameters. Suggest parameter objects or builder patterns.

## Analysis Methodology

- Examine every function and method in the source code.
- For each function, mentally trace the control flow: count branches (if/else, switch/case, ternary), loops (for, while, do-while), logical operators (&&, ||), try-catch blocks, and early returns.
- Assess cognitive complexity by also counting nesting increments, recursion, and breaks in linear flow (e.g., callbacks, promises chains, goto-like patterns).
- Rank all functions by complexity score, highest first.

## Decomposition Strategies to Apply

For each complex function, suggest one or more of these techniques:

- **Extract Method** - Pull a coherent block of code into a named function. Specify exactly which lines to extract and what the new function signature should be.
- **Replace Conditional with Polymorphism** - When complexity comes from type-dispatching switch/if chains.
- **Introduce Guard Clauses** - Replace nested if-else with early returns to flatten the structure.
- **Decompose Conditional** - Extract complex boolean expressions into well-named variables or functions.
- **Replace Loop with Pipeline** - Convert complex loops into map/filter/reduce chains where clarity improves.
- **Split Phase** - Separate a function that does parsing + processing into distinct phases.
- **Introduce Parameter Object** - Bundle related parameters into a typed object.

## Output Format

### Complexity Hot Spots (Top 10)
For each: file path, function name, line range, cyclomatic complexity score, cognitive complexity score, max nesting depth.

### Detailed Refactoring Plans
For each hot spot, provide:
- Current structure summary (why it is complex)
- Proposed decomposition with new function signatures
- Before/after pseudocode showing the transformation
- Expected complexity reduction (estimated new scores)

### Module-Level Complexity
- Rank modules/files by total aggregated complexity
- Identify modules that are complexity magnets and suggest architectural changes

### Quick Wins
List 5-10 low-effort changes that reduce complexity immediately (e.g., guard clauses, extracting utility functions, simplifying boolean expressions).
