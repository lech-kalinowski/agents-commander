---
name: Caching Strategy
description: Design multi-layer caching: browser cache, CDN, application cache, database cache. Define cache invalidation strategies, TTLs, cache warming, cache-aside vs write-through vs write-behind patterns.
category: backend
agents: [any]
panels: 1
---
You are a caching architecture expert. Design or review the caching strategy for this project.

**Address each caching layer:**

1. **Browser / Client Cache**
   - Configure Cache-Control headers for static assets (immutable for hashed files, short TTL for HTML)
   - Set appropriate ETag and Last-Modified headers for conditional requests
   - Implement service worker caching for offline support and performance
   - Verify no sensitive data is cached in shared caches (use private directive)
   - Check that API responses have appropriate cache headers (no-store for user-specific data)

2. **CDN Layer**
   - Define cache rules for different content types at the CDN level
   - Configure cache key composition (URL, headers, cookies to vary on)
   - Set up cache purging mechanisms for content updates
   - Implement edge-side includes (ESI) for pages with mixed cacheable/dynamic content
   - Configure stale-while-revalidate and stale-if-error at the CDN

3. **Application Cache**
   - Choose the appropriate caching pattern for each use case:
     - **Cache-Aside (Lazy Loading):** Application checks cache first, fetches from DB on miss, populates cache
     - **Write-Through:** Application writes to cache and DB simultaneously
     - **Write-Behind (Write-Back):** Application writes to cache, cache asynchronously writes to DB
     - **Read-Through:** Cache itself fetches from DB on miss
   - Select a cache backend (Redis, Memcached, in-process) based on data characteristics
   - Define key naming conventions and namespace strategies
   - Implement proper serialization/deserialization for cached objects

4. **Database Cache**
   - Evaluate database query cache configuration and effectiveness
   - Identify queries suitable for materialized views with refresh schedules
   - Consider database result caching for expensive aggregation queries
   - Review prepared statement caching and connection pool settings

5. **Cache Invalidation**
   - Define invalidation strategies for each cached resource:
     - TTL-based expiration with appropriate durations
     - Event-driven invalidation (on write, invalidate related cache entries)
     - Version-based invalidation (increment version key to invalidate a set of keys)
   - Handle cache stampede prevention (locking, probabilistic early expiration)
   - Implement tag-based invalidation for related cache entries
   - Plan for cache consistency in distributed systems (eventual consistency tradeoffs)

6. **Cache Warming**
   - Identify critical data that should be pre-cached on application start
   - Implement background cache warming for frequently accessed data
   - Plan cache warming after deployments or cache flushes
   - Avoid thundering herd on cold cache scenarios

7. **Monitoring and Observability**
   - Track cache hit rates, miss rates, and eviction rates
   - Monitor cache memory usage and set appropriate max-memory policies
   - Alert on cache hit rate drops that indicate invalidation issues
   - Log cache operations for debugging (with sampling to avoid noise)
   - Monitor cache latency (get/set operation times)

**Deliver a caching architecture document with a layer diagram, specific TTL recommendations per resource type, invalidation flows, and a monitoring dashboard specification.**
