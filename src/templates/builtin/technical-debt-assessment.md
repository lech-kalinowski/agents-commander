---
name: Technical Debt Assessment
description: Assess technical debt across the codebase, categorize it, estimate remediation effort, and create a prioritized paydown plan.
category: code-quality
agents: [any]
panels: 1
---
Perform a comprehensive technical debt assessment of this codebase. Identify, categorize, and prioritize all forms of technical debt, then produce an actionable paydown plan.

## Debt Discovery Process

Systematically scan the codebase for the following debt indicators:

### 1. Code-Level Debt
- **TODO/FIXME/HACK/WORKAROUND comments** - Catalog every one with file path, line number, and content. These are explicitly acknowledged debt.
- **Deprecated API usage** - Code using deprecated language features, library APIs, or internal APIs marked for removal.
- **Copy-pasted code** - Duplicated logic that should be abstracted.
- **Complex conditionals** - Overly complex boolean expressions or deeply nested control flow.
- **Missing abstractions** - Raw primitives or inline logic where a named concept would clarify intent.
- **Inconsistent patterns** - The same problem solved differently in different parts of the codebase.

### 2. Architectural Debt
- **Circular dependencies** - Modules that form dependency cycles.
- **Layer violations** - Components reaching across architectural boundaries.
- **Missing separation of concerns** - Business logic mixed with I/O, presentation, or infrastructure.
- **Monolithic components** - Large files or classes that should be decomposed.
- **Hardcoded values** - Configuration, URLs, paths, or thresholds embedded in source code.

### 3. Testing Debt
- **Missing test coverage** - Critical code paths with no tests.
- **Fragile tests** - Tests coupled to implementation details that break on refactoring.
- **Missing test infrastructure** - No mocking framework, no test utilities, no CI integration.
- **Untestable code** - Code that cannot be unit tested due to tight coupling or side effects.

### 4. Documentation Debt
- **Undocumented public APIs** - Exported functions, classes, or modules without documentation.
- **Outdated documentation** - Comments or docs that no longer match the code.
- **Missing architectural documentation** - No high-level explanation of how modules interact.

### 5. Dependency Debt
- **Outdated dependencies** - Packages significantly behind their latest versions.
- **Abandoned dependencies** - Packages no longer maintained.
- **Unnecessary dependencies** - Packages that could be replaced with small utility functions.
- **Missing lock file or version pinning** - Risk of non-reproducible builds.

## Debt Categorization

For each debt item, classify it:
- **Deliberate vs. Accidental** - Was this a conscious tradeoff or an oversight?
- **Reckless vs. Prudent** - Was the decision informed or uninformed?
- **Interest Rate** - How much ongoing cost does this debt incur? (High: blocks new features, causes bugs. Medium: slows development. Low: cosmetic.)
- **Principal** - How much effort to fix? (T-shirt sizes: XS, S, M, L, XL)

## Output Format

### Debt Inventory
| # | Category | Location | Description | Type | Interest | Principal | Priority |
|---|----------|----------|-------------|------|----------|-----------|----------|

### High-Interest Debt (blocking future work)
Detailed description of each item, explaining what it blocks, what risks it creates, and how it compounds over time.

### Debt Metrics
- Estimated total debt items by category.
- Percentage of codebase affected.
- Ratio of deliberate to accidental debt.

### Prioritized Paydown Plan
Organize into sprints/phases:

**Phase 1 - Quick Wins (< 1 day each)**
Items that are easy to fix and provide immediate value.

**Phase 2 - High-Interest Items (1-3 days each)**
Items causing the most ongoing pain. Fix these before adding new features.

**Phase 3 - Structural Improvements (3-5 days each)**
Architectural changes that enable future velocity.

**Phase 4 - Long-Term Health (5+ days each)**
Major refactorings that improve the codebase but are not blocking.

For each phase, list specific tasks, estimated effort, expected benefit, and dependencies on other tasks.
