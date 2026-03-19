---
name: Language Idioms Review
description: Review code for idiomatic language usage with modern alternatives and before/after examples.
category: learning
agents: [any]
panels: 1
---
Review the codebase for idiomatic usage of its programming language. Identify patterns that work but are not considered idiomatic, and suggest modern, community-standard alternatives.

First, detect the primary language(s) and their versions. Check configuration files (tsconfig.json, .python-version, go.mod, Cargo.toml, etc.) to determine the target language version and enabled features.

Then analyze the code for these aspects:

1. **Non-Idiomatic Patterns** - Find code that works but does not follow the language's conventions. For each instance:
   - Show the current code (file path, line numbers)
   - Explain why it is non-idiomatic
   - Show the idiomatic alternative with a before/after comparison
   - Explain the benefits (readability, performance, safety, conciseness)
   - Rate the priority of changing it: high (confusing/error-prone), medium (unconventional), low (stylistic preference)

2. **Modern Language Features** - Identify opportunities to use newer language features that the project's target version supports but the code does not use:
   - New syntax (optional chaining, pattern matching, destructuring, etc.)
   - New standard library additions that replace hand-rolled utilities
   - Type system features that would improve safety
   - Async/concurrency primitives that simplify complex flows

3. **Error Handling** - Review error handling patterns against language-specific best practices:
   - Are errors handled consistently?
   - Are language-specific error types used correctly (Result/Option in Rust, error returns in Go, exceptions in Python/Java)?
   - Are errors swallowed silently anywhere?
   - Is error context preserved through the call chain?

4. **Naming Conventions** - Check adherence to language naming conventions:
   - Variable, function, class, and file naming (camelCase, snake_case, PascalCase as appropriate)
   - Acronym handling (URL vs Url vs url)
   - Boolean naming (is/has/should prefixes)
   - Constants and enum values

5. **Language-Specific Best Practices** - Review patterns unique to the language:
   - Memory management idioms (ownership in Rust, defer in Go, context managers in Python)
   - Collection operations (map/filter/reduce vs loops, list comprehensions, iterators)
   - Null/nil/undefined handling patterns
   - Module and package organization conventions
   - Standard formatting (gofmt, rustfmt, prettier, black)

6. **Anti-Patterns** - Identify language-specific anti-patterns:
   - Reimplementing standard library functionality
   - Fighting the type system instead of leveraging it
   - Ignoring language-specific concurrency primitives
   - Using escape hatches (any, unsafe, reflect) unnecessarily

Provide a summary table of all findings organized by severity and effort to fix. Suggest an order for addressing them that maximizes code quality improvement per effort invested.
