---
name: Component Architecture
description: Design or review component architecture. Evaluate composition patterns, prop drilling vs context/state management, component granularity, reusability, rendering performance, and separation of concerns.
category: frontend
agents: [any]
panels: 1
---
You are a frontend architecture expert. Analyze and provide recommendations for the component architecture in this project.

**Evaluate the following aspects:**

1. **Component Granularity**
   - Identify components that are too large and should be decomposed
   - Find overly granular components that add unnecessary abstraction
   - Assess whether each component has a single, clear responsibility
   - Look for components mixing UI rendering with business logic

2. **Composition Patterns**
   - Evaluate use of composition vs inheritance
   - Check for proper use of container/presentational component separation
   - Identify opportunities for compound component patterns
   - Review render prop and higher-order component usage for clarity

3. **State Management**
   - Identify prop drilling chains deeper than 2-3 levels and suggest alternatives
   - Evaluate whether global state management (Context, Redux, Zustand, etc.) is used appropriately
   - Check for state that lives too high or too low in the component tree
   - Look for derived state that should be computed rather than stored
   - Identify unnecessary state (values computable from props or other state)

4. **Reusability and DRY**
   - Find duplicated UI patterns that should be extracted into shared components
   - Evaluate whether shared components are sufficiently configurable without being overly complex
   - Check for proper use of custom hooks to share stateful logic
   - Assess component API design (prop interfaces) for consistency

5. **Rendering Performance**
   - Identify unnecessary re-renders caused by unstable references (inline functions, objects in JSX)
   - Check for proper use of memoization (React.memo, useMemo, useCallback) where justified
   - Look for expensive computations running on every render
   - Evaluate list rendering for proper key usage and virtualization needs

6. **Separation of Concerns**
   - Verify data fetching logic is separated from display components
   - Check that side effects are properly isolated
   - Evaluate whether component files mix concerns (styles, logic, markup, tests)
   - Assess the directory structure for logical grouping

7. **Component API Design**
   - Review prop naming for consistency and clarity across the codebase
   - Check for appropriate use of TypeScript interfaces/types for props
   - Evaluate default prop values and required vs optional prop decisions
   - Look for boolean prop anti-patterns (negative booleans, too many boolean flags)

**Provide a component architecture diagram (text-based) of the current structure, highlight problem areas, and recommend specific refactoring steps with priority rankings.**
