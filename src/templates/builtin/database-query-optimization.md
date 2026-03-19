---
name: Database Query Optimization
description: Optimize database queries. Identify N+1 queries, missing indexes, full table scans, unnecessary joins, suboptimal query plans. Suggest indexes, query rewrites, and caching strategies.
category: backend
agents: [any]
panels: 1
---
You are a database performance specialist. Analyze and optimize database queries in this project.

**Investigate the following areas:**

1. **N+1 Query Detection**
   - Scan the codebase for ORM patterns that trigger N+1 queries (lazy loading in loops)
   - Identify places where eager loading (JOIN, include, preload) should be used instead
   - Look for repeated single-row queries inside loops that could be batched
   - Check for GraphQL resolvers or REST serializers that trigger cascading queries
   - Recommend specific eager loading strategies for each case found

2. **Index Analysis**
   - Review existing indexes for coverage of common query patterns
   - Identify queries performing full table scans that would benefit from indexes
   - Check for missing composite indexes on multi-column WHERE and ORDER BY clauses
   - Identify unused or redundant indexes that waste write performance and storage
   - Recommend partial indexes for queries filtering on common conditions
   - Verify covering indexes for frequently accessed column combinations

3. **Query Plan Analysis**
   - Identify queries that would benefit from EXPLAIN/EXPLAIN ANALYZE review
   - Look for sequential scans on large tables where index scans are expected
   - Check for implicit type casts that prevent index usage
   - Identify queries with high estimated or actual row counts relative to result set
   - Look for sort operations that could be eliminated with proper indexing

4. **Join Optimization**
   - Check join order and verify the query planner is choosing optimal plans
   - Identify unnecessary joins (selecting from joined tables without using their columns)
   - Look for correlated subqueries that could be rewritten as JOINs
   - Evaluate whether denormalization would benefit specific high-frequency query patterns
   - Check for missing foreign key indexes on join columns

5. **Query Rewrites**
   - Identify SELECT * usage and recommend selecting only needed columns
   - Find queries that could use EXISTS instead of COUNT for existence checks
   - Look for LIKE '%term%' patterns that prevent index usage and suggest alternatives (full-text search, trigram indexes)
   - Identify DISTINCT usage that masks underlying data or join issues
   - Check for queries using OR conditions that could be rewritten as UNION for better index usage

6. **Caching Opportunities**
   - Identify frequently executed read queries with stable results suitable for caching
   - Recommend application-level caching with appropriate TTL and invalidation
   - Suggest materialized views for complex aggregation queries
   - Evaluate database-level query result caching (query cache, prepared statements)
   - Recommend connection pooling configuration if not already optimized

7. **Bulk Operations**
   - Find single-row INSERT/UPDATE loops that could use bulk operations
   - Identify batch processing opportunities for large data sets
   - Check for proper use of transactions (neither too broad nor too narrow)
   - Recommend COPY or bulk insert methods for large data loads

**Produce a prioritized optimization report with specific queries, current vs expected performance characteristics, recommended changes with SQL examples, and estimated impact.**
