---
name: Code Walkthrough
description: Provide an interactive code walkthrough tracing request flow and explaining design decisions.
category: learning
agents: [any]
panels: 1
---
Provide a detailed, educational code walkthrough of this codebase. Trace the flow of execution from entry point to completion, explaining each layer and the reasoning behind design decisions.

Start by identifying the main entry point(s) of the application. Then pick a representative user action or request and trace it through the entire system.

Structure the walkthrough as a guided tour:

1. **Starting Point** - Identify where execution begins (main function, request handler, event listener). Explain what triggers this flow and what the expected outcome is. Show the exact file and function.

2. **Layer-by-Layer Trace** - Follow the execution path through each architectural layer. At each step:
   - Show the relevant code (function signatures, key logic blocks)
   - Explain what this code does and WHY it does it this way
   - Point out which design pattern is being used and why it was chosen here
   - Note any error handling, edge cases, or defensive programming
   - Highlight where data is transformed and what shape it takes at each stage

3. **Decision Points** - When the code branches (conditionals, strategy patterns, middleware chains), explain the possible paths and what determines which path is taken. Trace at least one alternate path to show how the system handles different scenarios.

4. **Non-Obvious Logic** - Flag any code that would confuse a new developer. This includes:
   - Clever optimizations that sacrifice readability
   - Workarounds for framework or library limitations
   - Historical decisions that no longer make obvious sense
   - Implicit contracts between modules (expected data shapes, ordering requirements)
   - Side effects that are not immediately apparent from function signatures

5. **Data Flow** - Map how data moves through the system. Show the shape of data at key boundaries (API input, database query, service-to-service, response output). Note where validation occurs and where it is assumed.

6. **Integration Points** - Where does this code interact with external systems (databases, APIs, file system, message queues)? What happens when those systems are slow or unavailable?

7. **Key Takeaways** - Summarize the 3-5 most important things a developer should understand about this code. What patterns should they follow when extending it? What invariants must they maintain?

Use a conversational, teaching tone. Anticipate questions a junior developer would ask and answer them proactively. When referencing code, always include the file path and function name so the reader can find it themselves.
