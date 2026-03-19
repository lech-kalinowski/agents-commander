---
name: State Management Design
description: Design or review state management architecture. Evaluate current approach, identify state categories, recommend patterns, and plan migration.
category: architecture
agents: [any]
panels: 1
---
Analyze the state management architecture of this application and produce a comprehensive design or improvement plan.

## Step 1: Current State Audit
- Inventory all stateful locations in the codebase: component state, global stores, context providers, caches, URL parameters, local storage, cookies, and server-side session.
- For each stateful entity, document: what data it holds, where it is read, where it is written, and how changes propagate.
- Identify pain points: stale state bugs, prop drilling, unnecessary re-renders, race conditions, state synchronization failures, or unclear ownership.

## Step 2: State Classification
Categorize all application state into these groups:
- **Server/remote state**: Data fetched from APIs that is the canonical source-of-truth on the server (user profiles, product catalogs, orders). This state needs caching, invalidation, and synchronization strategies.
- **Client/UI state**: Ephemeral interface state (modal open/closed, selected tab, hover state, form input in progress). This state is local and transient.
- **URL state**: State encoded in the URL for shareability and browser navigation (current page, filters, search query, selected item ID).
- **Form state**: In-progress user input with validation, dirty tracking, and submission handling.
- **Computed/derived state**: Values calculated from other state that should not be stored independently.

For each piece of state currently in the codebase, assign it to the correct category and flag any misclassifications (e.g., server state stored only in component state without sync).

## Step 3: Pattern Evaluation
Evaluate state management patterns against the application's specific needs:
- **Local component state**: Sufficient for truly local UI state. Identify what should stay local.
- **Global store (Redux, Zustand, MobX, Pinia)**: Evaluate for shared client state that multiple components need. Assess boilerplate overhead, devtools support, middleware ecosystem.
- **Server state libraries (TanStack Query, SWR, Apollo)**: Evaluate for remote data. These handle caching, background refetching, optimistic updates, and pagination automatically.
- **URL state management**: Ensure filters, pagination, and navigation state lives in the URL for shareability and back-button support.
- **Signals/fine-grained reactivity**: For performance-critical UIs where minimizing re-renders matters.

Recommend a specific combination of patterns, explaining why each was chosen for its state category.

## Step 4: Data Flow Design
- Define the unidirectional data flow: actions -> state updates -> view re-rendering.
- Design the update patterns: optimistic updates for responsiveness, pessimistic updates for critical operations.
- Plan cache invalidation: when server state changes, how do all consumers get updated? (query invalidation, WebSocket push, polling)
- Handle derived state: use selectors or computed values rather than storing derived data.
- Address concurrency: what happens when two components update the same state simultaneously, or when a mutation races with a refetch?

## Step 5: Migration Plan
If recommending changes to the current approach:
1. **Incremental adoption**: Identify a single feature or module to migrate first as a proof of concept.
2. **Coexistence strategy**: How old and new state management patterns coexist during migration.
3. **Testing approach**: How to verify state behavior is preserved during migration (snapshot tests, integration tests).
4. **Performance benchmarks**: Measure re-render counts, memory usage, and time-to-interactive before and after.

## Step 6: Deliverables
1. State inventory table: every piece of state, its category, current location, and recommended location.
2. Architecture diagram: data flow between state stores, components, and external sources.
3. Recommended patterns with justification for each state category.
4. Migration roadmap with phased approach and rollback strategy.
5. Best practices document: naming conventions, file organization, update patterns, and testing guidelines for the chosen approach.
