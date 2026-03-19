---
name: Database Schema Design
description: Design or review database schema: normalization analysis, index strategy, foreign key constraints, data types, naming conventions, migration strategy, query access patterns.
category: data
agents: [any]
panels: 1
---
You are a database schema design expert. Design or review the database schema for this project.

**Evaluate and provide recommendations for:**

1. **Normalization Analysis**
   - Assess the current normalization level of each table (1NF through 3NF/BCNF)
   - Identify denormalization that exists and evaluate whether it is justified by query patterns
   - Find redundant data that risks update anomalies
   - Recommend normalization improvements where data integrity is at risk
   - Identify intentional denormalization candidates where read performance justifies it
   - Document the rationale for any deviation from 3NF

2. **Data Types and Constraints**
   - Verify appropriate data types for each column (avoid stringly-typed data)
   - Check for proper use of numeric precision (DECIMAL for money, not FLOAT)
   - Ensure UUID vs auto-increment integer choice is consistent and justified
   - Verify NOT NULL constraints on columns that should always have values
   - Check for appropriate DEFAULT values
   - Evaluate use of ENUM/CHECK constraints vs application-level validation
   - Review text column length limits and their appropriateness

3. **Naming Conventions**
   - Verify consistent table naming (plural vs singular, snake_case vs camelCase)
   - Check column naming conventions across all tables
   - Ensure foreign key columns follow a pattern (e.g., user_id references users.id)
   - Verify index naming conventions are descriptive (idx_users_email_active)
   - Check constraint naming for clarity

4. **Foreign Keys and Referential Integrity**
   - Verify all relationships have proper foreign key constraints
   - Check ON DELETE and ON UPDATE behaviors (CASCADE, SET NULL, RESTRICT)
   - Identify soft-delete patterns and their interaction with foreign keys
   - Look for orphaned records or missing referential integrity
   - Evaluate junction/join tables for many-to-many relationships

5. **Index Strategy**
   - Design indexes based on actual query access patterns, not guesswork
   - Create composite indexes with correct column order (most selective first for equality, range columns last)
   - Identify covering indexes for frequent query patterns
   - Plan partial indexes for filtered queries (e.g., WHERE active = true)
   - Evaluate unique indexes for business rule enforcement
   - Check for index bloat and plan periodic maintenance (REINDEX, VACUUM)

6. **Query Access Patterns**
   - Document the primary read and write patterns for each table
   - Identify hot tables with high read/write ratios and plan accordingly
   - Design the schema to support the most common queries efficiently
   - Plan for aggregation queries: pre-computed columns, materialized views, or summary tables
   - Consider read replica routing for heavy read workloads

7. **Migration Strategy**
   - Plan schema migrations that support zero-downtime deployments
   - Use expand-and-contract pattern for breaking changes
   - Implement reversible migrations with proper rollback procedures
   - Handle large table alterations without locking (online DDL, shadow tables)
   - Version control all migration scripts
   - Plan data backfill strategies for new columns

8. **Time and Audit Fields**
   - Ensure created_at and updated_at timestamps on all tables
   - Implement audit logging for sensitive data changes
   - Choose between soft delete (deleted_at) and hard delete with rationale
   - Consider temporal tables or event sourcing for history requirements
   - Use proper timezone handling (store in UTC, convert at application layer)

**Deliver a schema design document with an entity-relationship diagram (text-based), index recommendations, migration plan, and a review of each table against the criteria above.**
