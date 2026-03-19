---
name: Code Smell Detection
description: Identify code smells across the codebase, rank by severity, and suggest targeted refactoring fixes.
category: code-quality
agents: [any]
panels: 1
---
Perform a thorough code smell detection analysis on this codebase. Systematically scan for the following categories of code smells and report your findings.

## Analysis Checklist

Work through each smell category methodically:

1. **Long Methods / Functions** - Identify functions exceeding 30 lines or performing more than one logical task. Note the file path, function name, and line count.
2. **God Classes / God Modules** - Find classes or modules that have too many responsibilities, too many methods, or excessive lines of code (>300 lines). List their responsibilities.
3. **Feature Envy** - Locate methods that reference data or methods from other classes/modules more than their own. Identify which module they truly belong to.
4. **Data Clumps** - Find groups of parameters or fields that repeatedly appear together across multiple functions or classes. Suggest a data object or type to encapsulate them.
5. **Primitive Obsession** - Identify places where primitive types (string, number, boolean) are used instead of small domain objects (e.g., email as string vs. Email type, currency as number vs. Money type).
6. **Switch Statement Smell** - Find switch/case or long if-else chains that dispatch on type or status. Suggest polymorphism or strategy pattern replacements.
7. **Parallel Inheritance Hierarchies** - Detect cases where adding a subclass in one hierarchy forces you to add one in another.
8. **Lazy Classes** - Identify classes or modules that do too little to justify their existence. Suggest inlining or merging.
9. **Speculative Generality** - Find abstractions, interfaces, or generic code that is only used in one place and adds unnecessary complexity.
10. **Dead Code** - Locate unreachable code, unused exports, unused parameters, commented-out code blocks, and unused imports.

## Methodology

- Scan every source file in the project (exclude node_modules, dist, build artifacts).
- For each smell found, record: file path, line number(s), smell category, and a brief description.
- Assess the impact: does this smell make the code harder to read, test, extend, or maintain?

## Output Format

Organize your findings as follows:

### Critical Severity (address immediately)
For each finding: file path, line range, smell type, description, and a concrete refactoring suggestion with example code.

### High Severity (address soon)
Same format as above.

### Medium Severity (address when convenient)
Same format as above.

### Low Severity (cosmetic / minor)
Same format as above.

### Summary Statistics
- Total smells found per category
- Files with the highest smell density
- Top 3 recommended refactorings by impact-to-effort ratio

Be specific and actionable. Every finding must include a concrete fix suggestion, not just a description of the problem.
