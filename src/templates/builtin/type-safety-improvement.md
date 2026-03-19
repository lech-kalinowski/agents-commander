---
name: Type Safety Improvement
description: Improve type safety by eliminating any types, adding annotations, narrowing unions, and adding runtime validation.
category: code-quality
agents: [any]
panels: 1
---
Perform a thorough type safety audit of this codebase. Identify every place where type safety is weak or missing, and provide concrete improvements to strengthen the type system's ability to catch bugs at compile time.

## Type Safety Issues to Detect

### 1. Eliminate `any` Types
- Find every occurrence of `any` (explicit and implicit) across the codebase.
- For each: determine the actual type that should be used and provide the replacement.
- Check for `any` hidden in: function parameters, return types, variable declarations, type assertions (`as any`), generic defaults, third-party type definitions.
- Also find `unknown` types that could be narrowed further with type guards.

### 2. Add Missing Type Annotations
- Identify functions with implicit return types. Add explicit return type annotations, especially for exported/public functions.
- Find variables whose types are inferred as overly broad (e.g., `let x = []` infers `any[]`).
- Check that callback parameters in higher-order functions have proper types.
- Ensure event handlers and listener callbacks are typed.

### 3. Narrow Union Types
- Find union types that are consumed without proper narrowing (e.g., `string | number` used without checking which it is).
- Identify discriminated unions that lack a discriminant property.
- Add type guards (user-defined type predicates, `in` operator checks, `instanceof` checks) where narrowing is needed.
- Look for nullable types (`T | null | undefined`) that are used without null checks.

### 4. Add Exhaustiveness Checks
- Find switch statements and if-else chains on discriminated unions that do not handle all cases.
- Add `never` checks in default branches to ensure compile-time errors when new variants are added.
- Ensure pattern matching is complete on all enum values and union members.

### 5. Improve Generic Constraints
- Find generic type parameters that are unconstrained (`<T>`) but should have bounds (`<T extends SomeType>`).
- Identify generic functions where the type parameter is not actually used to create a relationship between inputs and outputs (unnecessary generics).
- Look for places where conditional types or mapped types could replace manual type computations.

### 6. Runtime Validation at Boundaries
- Identify all external data entry points: API responses, user input, file reads, environment variables, URL parameters, form data, WebSocket messages.
- For each boundary: check if runtime validation exists. If not, recommend a validation approach (zod, io-ts, custom validators, JSON Schema).
- Ensure parsed data is typed as `unknown` before validation, not assumed to match a type.

### 7. Type Assertion Audit
- Find all type assertions (`as Type`, `<Type>`, `!` non-null assertions).
- For each: determine if the assertion is necessary or if proper type narrowing could replace it.
- Flag dangerous assertions (e.g., `as any`, casting to unrelated types) that bypass the type system entirely.

## Analysis Methodology

- Scan all source files for type-safety issues using the categories above.
- Prioritize by risk: type holes at boundaries and in shared utilities are more dangerous than those in leaf modules.
- Consider enabling or recommending stricter compiler options: `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

## Output Format

### Type Safety Score
Rate the codebase on a scale: Weak / Fair / Good / Strong. Justify with data.

### Critical Fixes (type holes that can cause runtime errors)
For each: file path, line, current code, proposed fix with complete type annotation.

### `any` Elimination Plan
List every `any` occurrence grouped by file. For each, provide the replacement type.

### Missing Annotations
List exported functions and public methods missing return type annotations.

### Boundary Validation Gaps
For each external data boundary: what enters unvalidated and a proposed validation schema.

### Compiler Configuration Recommendations
List TypeScript compiler flags that should be enabled and the expected impact of each.

### Migration Strategy
If the codebase has many type safety issues, provide a phased approach:
1. Enable strict compiler flags incrementally.
2. Fix `any` types starting from shared/core modules outward.
3. Add boundary validation at the most critical entry points first.
4. Add exhaustiveness checks to all discriminated unions.
