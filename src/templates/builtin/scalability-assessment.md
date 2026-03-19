---
name: Scalability Assessment
description: Assess application scalability. Identify bottlenecks, recommend horizontal scaling strategies, caching layers, database optimization, and async processing.
category: architecture
agents: [any]
panels: 1
---
Perform a comprehensive scalability assessment of this application. Identify current limitations and produce a concrete scaling strategy.

## Step 1: Architecture Inventory
- Map the current architecture: application servers, databases, caches, external services, background workers, and their interconnections.
- Identify the deployment model: single instance, multi-instance, containerized, serverless, or hybrid.
- Document current resource utilization patterns if available (CPU, memory, I/O, network).
- Determine the scaling axis: what metric drives scaling needs (concurrent users, request throughput, data volume, processing time).

## Step 2: Bottleneck Identification
Analyze the codebase and architecture for scalability bottlenecks:
- **Stateful components**: In-memory sessions, local file storage, in-process caches, singleton state. These prevent horizontal scaling. Catalog each instance.
- **Database bottlenecks**: N+1 queries, missing indexes, full table scans, lock contention, connection pool exhaustion, write-heavy tables without partitioning.
- **Shared resources**: Single database instance, shared file system, centralized queue, single-threaded processing.
- **Synchronous blocking**: Long-running synchronous operations that hold connections or threads (HTTP calls, file I/O, heavy computation in request path).
- **Memory leaks and unbounded growth**: Caches without eviction, accumulating event listeners, growing data structures.

## Step 3: Horizontal Scaling Strategy
Design the path to horizontal scalability:
- **Stateless application tier**: Externalize all state — move sessions to Redis/database, use object storage for files, use distributed cache.
- **Load balancing**: Recommend strategy (round-robin, least connections, consistent hashing) based on workload characteristics.
- **Database scaling**: Read replicas for read-heavy workloads. Connection pooling (PgBouncer, ProxySQL). Evaluate sharding strategy for write scaling — choose shard key, handle cross-shard queries.
- **Auto-scaling policies**: Define scaling triggers (CPU > 70%, request latency > 500ms, queue depth > 1000) and cooldown periods.

## Step 4: Caching Architecture
Design a multi-layer caching strategy:
- **Application-level cache**: Identify hot data paths and cache candidates. Define TTL, invalidation strategy (time-based, event-based, write-through).
- **Distributed cache** (Redis/Memcached): Cache database query results, computed values, session data. Size the cache based on working set.
- **HTTP caching**: Set appropriate Cache-Control headers, implement ETags, use CDN for static assets and cacheable API responses.
- **Cache stampede prevention**: Implement locking or probabilistic early expiration for high-traffic cache keys.

## Step 5: Async Processing and Decoupling
- Identify operations that can be moved off the critical request path: email sending, report generation, data aggregation, third-party API calls.
- Design a job queue architecture: choose between simple task queues (Bull, Celery) and full message brokers (RabbitMQ, Kafka).
- Define worker scaling independently from web tier.
- Implement back-pressure mechanisms to prevent queue overflow.

## Step 6: Deliverables
Produce a scalability roadmap with:
1. **Current state assessment**: Architecture diagram with annotated bottlenecks, rated by severity.
2. **Quick wins**: Changes achievable in days that yield immediate improvement (index additions, query optimization, obvious caching).
3. **Medium-term improvements**: Stateless refactoring, caching layers, async offloading (weeks of effort).
4. **Long-term architecture changes**: Database sharding, service decomposition, event-driven decoupling (months of effort).
5. **Capacity planning**: Estimate current maximum throughput and projected capacity after each improvement phase.
6. **Monitoring and alerting**: Key metrics to track (p99 latency, error rate, saturation) with recommended thresholds.
