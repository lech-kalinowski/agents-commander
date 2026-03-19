---
name: Modular Architecture Review
description: Review module boundaries and dependencies. Verify separation of concerns, check for circular dependencies, assess cohesion, and evaluate coupling.
category: architecture
agents: [any]
panels: 1
---
Perform a thorough modular architecture review of this codebase. Assess the quality of module boundaries and produce actionable restructuring recommendations.

## Step 1: Module Inventory and Dependency Mapping
- Identify all modules, packages, or logical groupings in the codebase (directories, namespaces, packages).
- For each module, catalog its public API surface: exported functions, classes, types, and constants.
- Map the dependency graph: which modules import from which. Identify the direction of all dependencies.
- Visualize the dependency structure textually (e.g., module A -> module B -> module C) and note the depth of the dependency tree.

## Step 2: Circular Dependency Detection
- Trace all import chains to detect circular dependencies (A -> B -> C -> A).
- For each cycle found:
  - Identify the root cause: shared types, callback registrations, bidirectional communication, or layering violations.
  - Assess the severity: does the cycle cause initialization issues, complicate testing, or prevent independent deployment?
  - Propose a resolution: dependency inversion, extracting shared interfaces to a common module, event-based decoupling, or restructuring the module boundary.

## Step 3: Cohesion Assessment
Evaluate each module's internal cohesion:
- **Functional cohesion** (ideal): Does every element in the module contribute to a single well-defined task?
- **Logical cohesion** (acceptable): Are elements grouped because they perform similar functions, even if on different data?
- **Coincidental cohesion** (problematic): Are unrelated functions bundled together for convenience?
- Flag modules that mix concerns: e.g., a module handling both business logic and database access, or UI rendering and state management.
- Check for "utility" or "helpers" modules that are dumping grounds for unrelated functions. Recommend redistribution.

## Step 4: Coupling Evaluation
Assess inter-module coupling at each level:
- **Data coupling** (ideal): Modules communicate through simple, well-defined data structures.
- **Stamp coupling** (acceptable): Modules pass complex structures but only use parts of them.
- **Control coupling** (concerning): One module controls the behavior of another via flags or parameters.
- **Content coupling** (problematic): One module directly accesses or modifies the internals of another.
- Measure afferent coupling (who depends on this module) and efferent coupling (what this module depends on). High afferent coupling means the module is critical and changes are risky. High efferent coupling means the module is fragile.

## Step 5: Layering and Boundary Verification
- Verify that architectural layers (presentation, business logic, data access, infrastructure) are respected.
- Check that dependencies flow in one direction: outer layers depend on inner layers, never the reverse.
- Identify boundary violations: direct database access from UI code, business logic in controllers, infrastructure details leaking into domain models.
- Verify that each module has a clear, narrow public interface and hides its implementation details.

## Step 6: Deliverables
1. **Dependency graph**: Textual representation of module dependencies with cycle annotations.
2. **Module health scorecard**: Rate each module on cohesion (high/medium/low), coupling (loose/moderate/tight), and boundary clarity (clean/leaky/absent).
3. **Critical issues**: Ranked list of the most impactful problems (circular deps, high coupling, low cohesion) with specific file references.
4. **Restructuring recommendations**: For each issue, provide a concrete refactoring plan — what to extract, what to merge, what to invert — with estimated effort.
5. **Dependency rules**: Propose enforceable rules (e.g., linter configs, import restrictions) to prevent architectural decay going forward.
