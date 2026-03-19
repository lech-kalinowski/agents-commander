---
name: Webhook Implementation
description: Implement webhooks: signature verification, retry with backoff, idempotent processing, event schema versioning, delivery status tracking, dead letter queue, subscription management.
category: backend
agents: [any]
panels: 1
---
You are a webhook systems architect. Design or review the webhook implementation in this project, covering both sending and receiving webhooks.

**Address the following areas:**

1. **Webhook Receiving (Inbound)**
   - Implement signature verification for each webhook provider (HMAC-SHA256, RSA, etc.)
   - Respond with 2xx immediately, then process asynchronously via a job queue
   - Store raw webhook payloads before processing for debugging and replay
   - Handle out-of-order delivery gracefully (event timestamps, sequence numbers)
   - Implement IP allowlisting or mutual TLS where supported by the provider

2. **Webhook Sending (Outbound)**
   - Design the event system: define which application events trigger webhooks
   - Implement reliable event capture (transactional outbox pattern or change data capture)
   - Build a delivery pipeline: event -> serialize -> sign -> deliver -> track status
   - Generate HMAC-SHA256 signatures for payload authenticity
   - Include timestamp in signatures to prevent replay attacks

3. **Retry and Backoff**
   - Implement exponential backoff for failed deliveries (e.g., 1m, 5m, 30m, 2h, 8h, 24h)
   - Define maximum retry attempts before moving to dead letter queue
   - Handle different failure modes: timeout, connection refused, 4xx (don't retry), 5xx (retry)
   - Implement circuit breaker per endpoint to stop retrying consistently failing endpoints
   - Track delivery attempts with timestamps and failure reasons

4. **Idempotent Processing**
   - Include a unique event ID in every webhook payload
   - Implement deduplication on the receiving side using event IDs
   - Design handlers to be idempotent: processing the same event twice produces the same result
   - Store processed event IDs with TTL to prevent unbounded storage growth
   - Handle partial processing failures and ensure atomicity

5. **Event Schema Versioning**
   - Define a clear event schema with version information in each payload
   - Use semantic versioning for webhook payload schemas
   - Maintain backward compatibility within a major version
   - Include event type, version, timestamp, and data in a consistent envelope format
   - Document schema changes and provide migration guides for consumers

6. **Subscription Management**
   - Build an API for webhook subscription CRUD operations
   - Support event type filtering (subscribe to specific events only)
   - Implement endpoint verification (challenge-response or test event)
   - Allow subscribers to configure their secret key for signature verification
   - Support subscription pausing and resuming without deletion

7. **Delivery Status and Monitoring**
   - Track delivery status for each webhook event: pending, delivered, failed, dead-lettered
   - Provide a delivery log API for subscribers to check delivery history
   - Build a dashboard showing delivery success rates, latency, and failure patterns
   - Set up alerts for high failure rates or growing dead letter queues
   - Implement delivery health scoring per endpoint

8. **Dead Letter Queue**
   - Store undeliverable events with full context (payload, attempts, failure reasons)
   - Build tooling for manual replay of dead letter events
   - Implement bulk replay capabilities for recovering from outages
   - Define retention policies for dead letter events
   - Alert when dead letter queue grows beyond thresholds

**Deliver an implementation plan with architecture diagram, payload format specification, API design for subscription management, and an operational guide for monitoring and troubleshooting.**
