---
name: Dependency Analysis
description: Analyze module dependencies, identify circular dependencies, tight coupling, and suggest architectural improvements.
category: code-quality
agents: [any]
panels: 1
---
Perform a deep analysis of the module dependency structure in this codebase. Map the dependency graph, identify problematic patterns, and suggest architectural improvements to reduce coupling and improve modularity.

## Dependency Graph Construction

1. **Map All Imports** - For every source file, catalog all imports (both internal project modules and external packages). Build a directed graph where an edge from A to B means "A depends on B."
2. **Identify Layers** - Determine if the codebase has an implicit or explicit layered architecture (e.g., presentation -> business logic -> data access). Map which modules belong to which layer.
3. **Calculate Fan-In and Fan-Out** - For each module: fan-in = number of modules that depend on it (instability indicator when low), fan-out = number of modules it depends on (coupling indicator when high).

## Problematic Patterns to Detect

### Circular Dependencies
- Find all cycles in the dependency graph (A -> B -> C -> A).
- For each cycle: list the exact files involved and the import that closes the loop.
- Assess impact: does the cycle cause initialization order issues, bundling problems, or conceptual confusion?
- Suggest how to break each cycle: extract shared interface, introduce mediator, restructure module boundaries, or apply dependency inversion.

### God Modules
- Identify modules with excessively high fan-in (everything depends on them) that are not intentionally shared utilities.
- Flag modules with high fan-out (they depend on everything), indicating they may be doing too much.
- For each: explain why this is problematic and suggest how to decompose.

### Tight Coupling
- Find pairs of modules that are always imported together (if you need A, you always also need B). These may need to be merged or have their interface clarified.
- Identify modules that reach deep into another module's internals rather than using its public API.
- Find cases of connascence: modules that must change together when one changes.

### Layer Violations
- Detect dependencies that go against the intended architectural layers (e.g., a data access module importing a UI component, a utility module depending on business logic).
- Flag bi-directional dependencies between layers.

### Unstable Dependencies
- Calculate instability metric for each module: I = fan-out / (fan-in + fan-out).
- Flag cases where a stable module (low I) depends on an unstable module (high I). Stable modules should depend only on other stable modules.

### External Dependency Concerns
- List all external packages and how many internal modules depend on each.
- Identify external packages that are deeply coupled into the codebase (used in many modules directly rather than wrapped).
- Flag deprecated, unmaintained, or security-vulnerable dependencies if detectable.

## Output Format

### Dependency Graph Summary
- Total modules, total edges, average fan-in, average fan-out.
- Top 10 most depended-on modules (highest fan-in).
- Top 10 most dependent modules (highest fan-out).

### Circular Dependencies
For each cycle: the module chain, which import closes the cycle, and a concrete strategy to break it.

### Coupling Hot Spots
Modules or module pairs with the tightest coupling. For each: explain the coupling, its consequences, and a decoupling strategy.

### Architectural Recommendations
1. Proposed module boundaries and layering.
2. Interfaces or abstractions to introduce for decoupling.
3. Modules to merge, split, or relocate.
4. Dependency injection opportunities.
5. Suggested refactoring order (break cycles first, then address coupling, then restructure layers).
