---
name: Background Job Design
description: Design background job processing: job queue architecture, retry strategies, dead letter handling, idempotency, priority queues, rate limiting, monitoring, and failure recovery.
category: backend
agents: [any]
panels: 1
---
You are a background job processing architect. Design or review the background job system for this project.

**Address the following areas:**

1. **Job Queue Architecture**
   - Select an appropriate queue backend (Redis/BullMQ, RabbitMQ, SQS, database-backed, etc.)
   - Define queue topology: separate queues by job type, priority, or resource requirements
   - Configure worker concurrency based on job characteristics (CPU-bound vs I/O-bound)
   - Plan for horizontal scaling of workers
   - Define job payload schema and serialization format

2. **Retry Strategies**
   - Implement exponential backoff with jitter for transient failures
   - Configure per-job-type retry limits based on the nature of the operation
   - Define which error types are retryable vs permanent failures
   - Implement progressive retry delays (e.g., 1s, 5s, 30s, 2m, 10m)
   - Track retry counts and include them in monitoring and alerting

3. **Dead Letter Handling**
   - Configure dead letter queues for jobs that exhaust all retries
   - Build tooling to inspect, replay, or discard dead letter jobs
   - Set up alerts when dead letter queue depth exceeds thresholds
   - Implement a workflow for investigating and resolving dead letter jobs
   - Define retention policies for dead letter queues

4. **Idempotency**
   - Ensure all jobs are safe to retry (idempotent design)
   - Implement idempotency keys to prevent duplicate processing
   - Use database transactions or distributed locks to prevent concurrent execution of the same job
   - Design job handlers to check completion state before re-executing
   - Handle partial completion scenarios (what if a job fails midway?)

5. **Priority Queues**
   - Define priority levels (critical, high, normal, low, bulk)
   - Ensure high-priority jobs are not starved by large volumes of normal-priority work
   - Implement fair scheduling so low-priority jobs eventually get processed
   - Allow priority escalation for jobs that have been waiting too long
   - Configure separate worker pools for different priority levels if needed

6. **Rate Limiting**
   - Implement rate limiting for jobs that call external APIs or rate-limited services
   - Use token bucket or sliding window rate limiting per external service
   - Configure concurrency limits to prevent overwhelming downstream services
   - Handle rate limit responses (429) by re-enqueuing with appropriate delay
   - Implement global and per-tenant rate limits

7. **Scheduling and Delayed Jobs**
   - Implement cron-like scheduling for recurring jobs
   - Support delayed job execution (run this job in 30 minutes)
   - Ensure scheduled jobs handle clock drift and timezone issues
   - Prevent duplicate scheduling of recurring jobs
   - Implement job deduplication for time-windowed operations

8. **Monitoring and Observability**
   - Track job processing metrics: throughput, latency, error rate, queue depth
   - Set up alerts for queue depth growth, processing delays, and error spikes
   - Implement job tracing to follow a request through async job processing
   - Build a dashboard showing job status distribution and processing trends
   - Log sufficient context for debugging failed jobs without logging sensitive data

**Provide a job processing architecture design with queue topology diagram, configuration recommendations, code patterns for job handlers, and an operational runbook for common issues.**
