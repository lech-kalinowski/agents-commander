---
name: SOLID Principles Review
description: Review code against all five SOLID principles, identify violations, and suggest targeted refactoring.
category: code-quality
agents: [any]
panels: 1
---
Conduct a rigorous review of this codebase against all five SOLID principles. For each principle, systematically identify violations, explain why they matter, and propose concrete refactoring steps.

## Principle-by-Principle Analysis

### 1. Single Responsibility Principle (SRP)
- Identify classes, modules, or functions that have more than one reason to change.
- For each violation: list the distinct responsibilities contained within, the file path and line range, and which responsibility should be extracted.
- Watch for: classes that mix business logic with I/O, modules that handle both data transformation and presentation, functions that validate and also persist data.

### 2. Open/Closed Principle (OCP)
- Find code that must be modified (rather than extended) to support new behavior.
- Look for: switch statements on types, if-else chains checking instanceof or discriminated unions without extensibility, hardcoded lists of handlers or strategies.
- Suggest: strategy pattern, plugin architecture, registry pattern, or polymorphism to make the code open for extension but closed for modification.

### 3. Liskov Substitution Principle (LSP)
- Check that subtypes and implementations can be substituted for their base types without breaking behavior.
- Look for: overridden methods that throw unexpected exceptions, subclasses that ignore or violate parent contracts, implementations that silently no-op required methods, type narrowing that breaks substitutability.
- Verify that preconditions are not strengthened and postconditions are not weakened in derived types.

### 4. Interface Segregation Principle (ISP)
- Find interfaces or abstract types that force implementers to depend on methods they do not use.
- Look for: large interfaces with many methods where most implementations only use a subset, "fat" configuration objects where consumers only need a few fields, parameter types that are broader than necessary.
- Suggest: splitting into focused role interfaces, using composition of smaller interfaces.

### 5. Dependency Inversion Principle (DIP)
- Identify high-level modules that directly depend on low-level implementation details.
- Look for: direct instantiation of dependencies (new ConcreteClass()), imports of concrete implementations in business logic modules, tight coupling to specific databases/APIs/file systems without abstraction.
- Suggest: introduce interfaces or abstract types, use dependency injection, apply the ports-and-adapters pattern.

## Methodology

- Review all source files, focusing on classes, modules, and their relationships.
- Map the dependency graph to understand coupling patterns.
- For each violation found, assess its severity: how much does it impede maintainability, testability, or extensibility?

## Output Format

For each SOLID principle, provide:

**Violations Found:**
| # | File Path | Line(s) | Description | Severity |
|---|-----------|---------|-------------|----------|
| 1 | ...       | ...     | ...         | High/Med/Low |

**Refactoring Recommendations:**
For each high-severity violation, provide:
- The specific refactoring technique to apply
- New interface/class/module signatures
- Code sketch showing the target state
- Dependencies or other files that would need to change

**Summary:**
- Overall SOLID compliance score (qualitative: strong, moderate, weak) per principle
- Top 5 highest-impact refactorings across all principles
- Suggested order of refactoring to minimize cascading changes
