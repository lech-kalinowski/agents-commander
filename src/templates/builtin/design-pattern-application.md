---
name: Design Pattern Application
description: Analyze code and identify where design patterns would improve the architecture. Cover creational, structural, and behavioral patterns with before/after examples.
category: architecture
agents: [any]
panels: 1
---
Analyze the codebase and identify opportunities to apply design patterns that would meaningfully improve the architecture. Follow this systematic methodology:

## Step 1: Code Structure Analysis
Scan the codebase for structural anti-patterns and code smells that indicate missing design patterns:
- Repeated object creation logic scattered across modules (suggests Factory or Builder)
- God classes or functions handling too many responsibilities (suggests Strategy or Command)
- Tight coupling between components that should be independent (suggests Observer or Mediator)
- Complex conditional chains selecting behavior at runtime (suggests Strategy or State)
- Direct dependencies on concrete implementations (suggests Adapter or Facade)

## Step 2: Creational Pattern Opportunities
Evaluate where creational patterns would reduce complexity:
- **Factory Method / Abstract Factory**: Identify places where `new` is called with conditional logic or where object creation details leak into business logic. Show how a factory encapsulates instantiation.
- **Builder**: Find constructors with many parameters or multi-step object assembly. Demonstrate fluent builder API.
- **Singleton**: Assess shared resources (config, logging, connection pools) but warn about testability trade-offs. Prefer dependency injection where possible.

## Step 3: Structural Pattern Opportunities
Evaluate where structural patterns would improve organization:
- **Adapter**: Identify incompatible interfaces between modules or third-party integrations that require translation layers.
- **Decorator**: Find cross-cutting concerns (logging, caching, validation) being copy-pasted across methods. Show how decorators compose behavior.
- **Facade**: Locate complex subsystems where callers need to orchestrate multiple objects. Design a simplified unified interface.

## Step 4: Behavioral Pattern Opportunities
Evaluate where behavioral patterns would clarify control flow:
- **Strategy**: Identify algorithm families where behavior varies by context. Extract interchangeable strategy implementations.
- **Observer**: Find places where state changes need to propagate to multiple dependents. Design event subscription mechanisms.
- **Command**: Locate operations that need undo/redo, queueing, or logging. Encapsulate requests as command objects.

## Step 5: Deliverables
For each recommended pattern, provide:
1. **Location**: The specific files and code sections affected.
2. **Problem**: What anti-pattern or smell exists today and why it matters.
3. **Pattern**: Which design pattern to apply and why it fits.
4. **Before**: The current code structure (simplified).
5. **After**: The refactored code structure with the pattern applied.
6. **Trade-offs**: Any added complexity, and why the benefit outweighs it.
7. **Implementation order**: Prioritize by impact and risk, starting with the highest-value, lowest-risk changes.

Focus on patterns that solve real problems in this codebase. Do not recommend patterns for their own sake. Each recommendation must reduce complexity, improve testability, or increase extensibility in a concrete way.
