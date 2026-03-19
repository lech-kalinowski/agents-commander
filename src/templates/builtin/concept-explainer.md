---
name: Concept Explainer
description: Explain a technical concept by showing how it is implemented in this codebase with analogies and progressive complexity.
category: learning
agents: [any]
panels: 1
---
Explain a technical concept by connecting abstract theory to the concrete implementation in this codebase. Make the concept approachable through analogies, ASCII diagrams, and progressively increasing complexity.

Follow this teaching structure:

1. **The Concept in One Sentence** - Start with a plain-language definition that a non-technical person could understand. Avoid jargon entirely in this first sentence. Then state why this concept matters in software development.

2. **Real-World Analogy** - Provide a concrete analogy from everyday life that captures the essence of the concept. Extend the analogy to cover the key properties and edge cases. Explicitly state where the analogy breaks down so it does not create misconceptions.

3. **ASCII Diagram** - Draw an ASCII art diagram that visualizes the concept. Show the components, their relationships, and the flow of data or control. Use clear labels and arrows. Keep it under 20 lines wide and 15 lines tall so it renders well in terminals.

```
+----------+     request     +----------+     query      +----------+
|  Client  | --------------> |  Server  | -------------> | Database |
|          | <-------------- |          | <------------- |          |
+----------+     response    +----------+     result     +----------+
```

4. **Level 1: The Basics** - Explain the simplest form of the concept. Find the most straightforward example in the codebase and walk through it line by line. Show only the essential code, hiding complexity. The reader should be able to understand this with no prior knowledge of the concept.

5. **Level 2: The Real Implementation** - Now show how the concept is actually used in this codebase. Reveal the complexity that was hidden in Level 1. Explain why the additional complexity exists (error handling, performance, extensibility, edge cases). Point out the specific files and functions.

6. **Level 3: Advanced Usage and Edge Cases** - Show the most sophisticated application of the concept in the codebase. Discuss edge cases, failure modes, and performance implications. Connect to related concepts (if concept is "caching", connect to "invalidation", "consistency", "TTL").

7. **Common Mistakes** - List the top 3-5 mistakes developers make with this concept. For each, show what goes wrong and how to do it correctly. If any of these mistakes exist in the current codebase, flag them diplomatically.

8. **When to Use and When Not To** - Provide clear criteria for when this concept is the right choice and when it adds unnecessary complexity. Reference specific scenarios from the project domain.

9. **Further Learning** - Suggest 2-3 resources for deeper understanding: a canonical book chapter, a well-regarded blog post, or a conference talk. Suggest a small exercise the reader can do within this codebase to solidify their understanding.

Write in a patient, encouraging tone. Never assume the reader should already know something. If you reference another concept, briefly define it in parentheses.
