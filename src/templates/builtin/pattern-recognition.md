---
name: Pattern Recognition
description: Identify and explain all design patterns used in the codebase with analysis and improvement suggestions.
category: learning
agents: [any]
panels: 1
---
Analyze the entire codebase and identify every design pattern in use, whether applied intentionally or emergently. Provide a comprehensive pattern catalog with concrete examples from the code.

For each pattern discovered, document the following:

1. **Pattern Name** - Use the canonical name from Gang of Four, POSA, Enterprise Patterns, or modern equivalents. If the pattern is a variation or hybrid, name the base pattern and describe the variation.

2. **Where It Is Used** - List every file and class/function where this pattern appears. Distinguish between the core implementation and the consumers/clients of the pattern. Show a brief code excerpt that best illustrates the pattern.

3. **Why It Was Chosen** - Analyze the context to determine what problem the pattern solves here. What flexibility does it provide? What coupling does it reduce? What would the code look like without this pattern?

4. **How Well It Is Implemented** - Evaluate the implementation quality:
   - Does it follow the pattern correctly or is it a partial/incorrect application?
   - Is it over-engineered for the current use case?
   - Are there violations of the pattern's intended contract?
   - Is it consistently applied across the codebase or used sporadically?

5. **Alternatives** - What other patterns could solve the same problem? Compare trade-offs: simplicity, testability, performance, extensibility. Would a simpler approach work given the current scale?

6. **Improvement Suggestions** - Concrete recommendations to strengthen the pattern usage:
   - Missing abstractions that would complete the pattern
   - Opportunities to extend the pattern to other parts of the codebase
   - Cases where the pattern adds unnecessary complexity and should be simplified

Organize patterns into categories:
- **Creational** (Factory, Builder, Singleton, etc.)
- **Structural** (Adapter, Decorator, Facade, Proxy, etc.)
- **Behavioral** (Observer, Strategy, Command, State, etc.)
- **Architectural** (MVC, Repository, CQRS, Event Sourcing, etc.)
- **Concurrency** (if applicable: Producer-Consumer, Actor, etc.)
- **Anti-Patterns** - Identify any anti-patterns present (God Object, Spaghetti Code, Golden Hammer, etc.) with specific refactoring suggestions.

Conclude with a pattern map showing how the patterns interact and support each other. Identify any gaps where a well-known pattern would significantly improve the codebase's structure or maintainability.
