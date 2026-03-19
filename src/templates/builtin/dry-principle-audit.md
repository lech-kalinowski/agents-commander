---
name: DRY Principle Audit
description: Find code duplication across the codebase and suggest abstractions to eliminate repeated patterns.
category: code-quality
agents: [any]
panels: 1
---
Perform a comprehensive DRY (Don't Repeat Yourself) audit of this codebase. Identify all forms of duplication, from exact copy-paste to structural and logical repetition, and propose consolidation strategies.

## Duplication Categories to Detect

1. **Exact Duplicates** - Identical or near-identical code blocks appearing in multiple locations. Even small blocks (3+ lines) that are copy-pasted count.
2. **Structural Duplicates** - Code that follows the same structure or pattern but with different variable names, types, or values. Examples: similar CRUD operations, repeated validation sequences, boilerplate initialization blocks.
3. **Logical Duplicates** - Different code that accomplishes the same logical task in different ways. Examples: multiple implementations of the same business rule, redundant utility functions.
4. **Data Duplication** - Constants, configuration values, or magic numbers/strings repeated across files instead of being defined once.
5. **Cross-Cutting Concern Duplication** - Repeated patterns for logging, error handling, authorization checks, or input validation scattered across modules instead of being centralized.

## Analysis Methodology

- Compare every source file against every other source file for textual similarity.
- Look for repeated patterns within single files (internal duplication).
- Check for similar function signatures that suggest duplicated behavior.
- Identify repeated import patterns that indicate missing shared modules.
- Scan for magic strings and numbers used in multiple locations.
- Examine test files for repeated setup/teardown patterns.

## For Each Duplication Found, Report

- **Locations**: All file paths and line ranges where the duplication occurs.
- **Duplication Type**: Which category from above.
- **Similarity Score**: Estimate what percentage of the code is identical vs. varied.
- **Root Cause**: Why does this duplication likely exist? (copy-paste, lack of abstraction, organic growth, etc.)

## Consolidation Strategies

For each group of duplicates, suggest the appropriate strategy:

- **Extract Shared Function/Method** - For duplicated logic. Provide the function signature and where it should live.
- **Create Base Class or Mixin** - For structural duplication in class hierarchies.
- **Introduce Generic/Template** - For code that varies only by type. Show the generic signature.
- **Create Shared Constants Module** - For repeated magic values. List all values to centralize.
- **Apply Middleware/Decorator Pattern** - For cross-cutting concern duplication.
- **Use Higher-Order Functions** - For duplication that varies by a strategy or callback.
- **Create Factory Functions** - For repeated object construction patterns.

## Output Format

### Duplication Map
Group related duplications together. For each group:
- All locations (file:line)
- The repeated code pattern (abbreviated)
- Recommended consolidation strategy
- Estimated lines of code that would be eliminated

### Priority Matrix
Rank duplication groups by:
- **Risk**: How likely are the copies to diverge and cause bugs?
- **Maintenance Cost**: How much effort is wasted keeping copies in sync?
- **Ease of Fix**: How straightforward is the consolidation?

### Summary Statistics
- Total duplicated line count and percentage of codebase
- Top 5 files with the most duplication
- Estimated line reduction after full deduplication
