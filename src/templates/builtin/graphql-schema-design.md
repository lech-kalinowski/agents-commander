---
name: GraphQL Schema Design
description: Design GraphQL schema: type definitions, query/mutation organization, resolver architecture, N+1 prevention with DataLoader, pagination strategy, error handling, schema federation.
category: data
agents: [any]
panels: 1
---
You are a GraphQL schema design expert. Design or review the GraphQL implementation in this project.

**Evaluate and provide recommendations for:**

1. **Type Definitions**
   - Design types that represent the domain model, not the database schema
   - Use clear, descriptive type and field names following GraphQL naming conventions (camelCase for fields, PascalCase for types)
   - Implement proper nullability: make fields non-null by default, only use nullable for genuinely optional data
   - Use custom scalar types for domain-specific values (DateTime, Email, URL, Money)
   - Define input types for mutations separate from output types
   - Use interfaces and unions for polymorphic types (e.g., SearchResult = User | Post | Comment)

2. **Query Organization**
   - Design root query fields as entry points to the graph, not as REST-like endpoints
   - Avoid deeply nested query designs that encourage expensive queries
   - Implement query complexity analysis and depth limiting to prevent abuse
   - Define field-level descriptions for self-documenting schema
   - Group related queries logically and consider namespacing with type extensions

3. **Mutation Design**
   - Follow the input/payload pattern: each mutation takes a single input type and returns a payload type
   - Include the mutated object, user errors, and success status in mutation payloads
   - Design mutations around user actions, not CRUD operations (addItemToCart, not updateOrder)
   - Implement proper error handling in mutation payloads (user errors vs system errors)
   - Use enums for error codes in mutation responses

4. **N+1 Prevention with DataLoader**
   - Implement DataLoader for every resolver that fetches related entities
   - Ensure DataLoaders are created per-request to prevent data leaking between users
   - Batch and cache database queries within a single request lifecycle
   - Monitor resolver execution to detect N+1 patterns in production
   - Use DataLoader for both database queries and external service calls

5. **Pagination Strategy**
   - Implement Relay-style cursor-based pagination (Connection, Edge, PageInfo) for large lists
   - Support first/after for forward pagination and last/before for backward pagination
   - Include totalCount as an optional field (warn about performance impact on large datasets)
   - Ensure cursor stability: cursors should remain valid even when data changes
   - Implement consistent pagination across all list fields

6. **Error Handling**
   - Distinguish between user errors (validation failures, business rule violations) and system errors
   - Return user errors as part of mutation payloads, not as GraphQL errors
   - Use GraphQL errors for unexpected system failures, authentication issues, and authorization failures
   - Implement error extensions with codes for machine-readable error classification
   - Define a consistent error format across all mutations
   - Handle partial errors gracefully (some fields resolve, others error)

7. **Performance and Security**
   - Implement query complexity scoring and reject overly expensive queries
   - Set maximum query depth limits
   - Use persisted queries in production to prevent arbitrary query execution
   - Implement field-level authorization using directives or middleware
   - Configure response caching with appropriate cache hints
   - Monitor slow resolvers and set up performance budgets

8. **Schema Federation and Evolution**
   - If using federation, design clear service boundaries with well-defined entity ownership
   - Plan for schema evolution: adding fields is safe, removing or changing fields requires deprecation
   - Use @deprecated directive with clear migration instructions
   - Maintain a schema changelog for consumers
   - Implement schema validation in CI to prevent breaking changes

**Deliver a schema design document with SDL type definitions, resolver architecture patterns, DataLoader implementation examples, and a migration strategy for schema evolution.**
