---
name: Event-Driven Architecture
description: Design or refactor to event-driven architecture. Identify events, define schemas, choose messaging patterns, handle eventual consistency, and design error handling.
category: architecture
agents: [any]
panels: 1
---
Design or refactor this application to use event-driven architecture. Perform a thorough analysis and produce an implementation plan.

## Step 1: Event Discovery and Modeling
- Analyze the codebase for implicit events: state changes, side effects triggered by operations, notifications, and cross-module communication.
- Apply Event Storming principles: identify domain events (past-tense verbs describing what happened), commands (requests that trigger events), and aggregates (entities that produce events).
- Classify events by type:
  - **Domain events**: Business-meaningful state changes (e.g., OrderPlaced, PaymentProcessed).
  - **Integration events**: Cross-service communication triggers.
  - **System events**: Infrastructure-level signals (e.g., HealthCheckFailed, ThresholdExceeded).
- Map the event flow: which components produce each event, which consume it, and what actions result.

## Step 2: Event Schema Design
For each identified event, define:
- **Schema**: Field names, types, required vs. optional, with a concrete example payload.
- **Envelope**: Standard metadata — event ID (UUID), timestamp, source, type, correlation ID, causation ID, schema version.
- **Versioning strategy**: Use schema evolution rules (add fields only, no removals, no type changes) or explicit version numbers with transformation functions.
- **Schema registry**: Recommend a schema validation approach (JSON Schema, Avro, Protobuf) to enforce contracts at publish time.

## Step 3: Messaging Pattern Selection
Evaluate and recommend patterns for each event flow:
- **Pub/Sub**: For broadcasting events to multiple independent consumers. Define topic naming conventions and subscription management.
- **Event Sourcing**: For aggregates where the full history of state changes is valuable. Design the event store, snapshot strategy, and replay mechanism.
- **CQRS**: For separating read and write models. Design the command side (event production), the projection/read side (materialized views), and the synchronization mechanism.
- **Request/Reply**: For cases requiring synchronous-like behavior over async infrastructure. Design correlation and timeout handling.

## Step 4: Consistency and Ordering
- Design for eventual consistency: identify where strong consistency is truly required vs. where eventual is acceptable.
- Event ordering guarantees: define partition keys to ensure ordering within an aggregate. Document where global ordering is not guaranteed and how consumers handle out-of-order delivery.
- Idempotency: design consumers to be idempotent using event ID deduplication or idempotent operations.
- Implement the Outbox Pattern where database writes and event publishing must be atomic.

## Step 5: Error Handling and Resilience
- **Dead Letter Queues (DLQ)**: Design DLQ routing for events that fail processing after retry exhaustion. Define monitoring, alerting, and reprocessing procedures.
- **Retry policies**: Specify retry count, backoff strategy (exponential with jitter), and failure classification (transient vs. permanent).
- **Poison message handling**: Detect and isolate messages that consistently cause consumer failures.
- **Compensating events**: For saga-like flows, define compensating events that undo partial operations on failure.

## Step 6: Deliverables
1. Event catalog: Complete list of events with schemas, producers, and consumers.
2. Architecture diagram (textual): Show event flows, message broker topology, and service interactions.
3. Implementation plan: Ordered list of changes to introduce event-driven patterns incrementally.
4. Monitoring requirements: Event throughput, consumer lag, DLQ depth, processing latency per event type.
5. Testing strategy: How to test event producers, consumers, and end-to-end event flows in isolation and integration.
