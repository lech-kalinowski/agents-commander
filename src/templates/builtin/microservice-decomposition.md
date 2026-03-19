---
name: Microservice Decomposition
description: Analyze a monolithic application and plan decomposition into microservices. Identify bounded contexts, define service boundaries, and design inter-service communication.
category: architecture
agents: [any]
panels: 1
---
Analyze this monolithic application and produce a comprehensive microservice decomposition plan. Follow this structured approach:

## Step 1: Domain Analysis and Bounded Context Identification
- Map the core business domains by examining models, database schemas, and business logic.
- Identify bounded contexts using Domain-Driven Design principles: look for natural seams where the language, models, or rules change.
- Document entity relationships that cross context boundaries — these are the most critical integration points.
- Create a context map showing relationships between bounded contexts (upstream/downstream, shared kernel, anti-corruption layer).

## Step 2: Service Boundary Definition
For each proposed microservice:
- Define its single responsibility and the business capability it owns.
- List the entities and aggregates it manages exclusively (data ownership).
- Identify the API surface it exposes to other services.
- Specify which current modules, classes, and database tables map to this service.
- Ensure each service can be deployed, scaled, and developed independently.

## Step 3: Data Ownership and Migration Strategy
- Assign every database table or collection to exactly one service.
- Identify shared data that must be split or replicated. Design the split strategy.
- Plan data migration: schema decomposition, data copying, dual-write periods, and cutover.
- Design cross-service queries: use API composition, materialized views, or CQRS read models.
- Address referential integrity across services using eventual consistency patterns.

## Step 4: Inter-Service Communication Design
- Classify each interaction as synchronous (REST/gRPC) or asynchronous (events/messages).
- For synchronous calls: define API contracts, timeouts, retries, and circuit breakers.
- For asynchronous communication: choose between event notification, event-carried state transfer, and request/reply patterns.
- Design the event schema registry and versioning strategy.
- Plan for distributed transactions using the Saga pattern where multi-service consistency is required. Specify compensating actions for each step.

## Step 5: Infrastructure and Cross-Cutting Concerns
- Service discovery and routing (API gateway, service mesh).
- Centralized logging, distributed tracing (correlation IDs), and metrics aggregation.
- Authentication and authorization propagation across services.
- Configuration management and secret handling per service.
- CI/CD pipeline design for independent service deployment.

## Step 6: Decomposition Roadmap
Produce a phased migration plan:
1. **Strangler Fig approach**: Identify the first service to extract, chosen for maximum independence and minimum cross-cutting impact.
2. **Incremental extraction order**: Sequence remaining services by dependency graph — extract leaf services first.
3. **Risk mitigation**: For each phase, define rollback strategy, feature flags, and parallel running periods.
4. **Success criteria**: Define measurable outcomes (deployment frequency, failure isolation, team autonomy) for each phase.

Deliver the full decomposition as a structured document with diagrams (described textually), service specifications, and a prioritized action plan.
