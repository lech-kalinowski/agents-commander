---
name: Data Migration Plan
description: Plan a data migration: schema changes, data transformation rules, zero-downtime strategy, rollback plan, data validation, performance testing with production-scale data.
category: data
agents: [any]
panels: 1
---
You are a data migration specialist. Plan and review data migration for this project.

**Address the following areas:**

1. **Migration Scope and Assessment**
   - Inventory all tables, columns, and relationships affected by the migration
   - Quantify data volumes: row counts, table sizes, index sizes
   - Identify dependencies: foreign keys, triggers, views, stored procedures, application code
   - Map source schema to target schema with transformation rules for each field
   - Classify changes: additive (new columns), transformative (restructure), destructive (remove)
   - Estimate total migration duration based on data volume and transformation complexity

2. **Data Transformation Rules**
   - Document exact transformation logic for each field (type conversions, value mappings, splits, merges)
   - Handle NULL values and missing data: defaults, backfill strategies, or explicit NULL
   - Define data cleansing rules (trimming, format standardization, deduplication)
   - Plan for encoding changes (character sets, collation updates)
   - Handle edge cases: empty strings vs NULLs, timezone conversions, precision loss
   - Write transformation scripts with clear comments explaining each rule

3. **Zero-Downtime Strategy**
   - Implement the expand-and-contract pattern:
     - **Expand:** Add new columns/tables alongside old ones
     - **Migrate:** Dual-write to both old and new, backfill historical data
     - **Switch:** Point application reads to new schema
     - **Contract:** Remove old columns/tables after verification period
   - Use database triggers or application-level dual-write during transition
   - Plan for feature flags to control the cutover in the application layer
   - Define the duration of the dual-write period and monitoring criteria for cutover
   - Handle in-flight transactions during schema switches

4. **Rollback Plan**
   - Define rollback triggers: what conditions warrant a rollback
   - Create rollback scripts for every migration step
   - Test rollback procedures with production-scale data before the actual migration
   - Plan for data written during the migration period that must be preserved during rollback
   - Define point-of-no-return and communicate it to stakeholders
   - Maintain reverse-sync capability during the dual-write period

5. **Data Validation**
   - Define validation checks to run before, during, and after migration:
     - Row count comparison between source and target
     - Checksum validation on critical columns
     - Referential integrity verification
     - Business rule validation (balances match, totals are consistent)
     - Sample record spot-checking with manual verification
   - Implement automated validation scripts that produce a clear pass/fail report
   - Define acceptable thresholds for data discrepancies (zero tolerance for financial data)
   - Plan validation for edge cases and boundary conditions

6. **Performance Testing**
   - Test migration scripts against production-scale data volumes (not just dev subsets)
   - Measure migration throughput and identify bottlenecks
   - Optimize batch sizes for bulk operations (INSERT...SELECT, UPDATE in batches)
   - Plan for index management: drop non-essential indexes before migration, rebuild after
   - Test database resource usage during migration (CPU, memory, I/O, lock contention)
   - Schedule migration during low-traffic windows if zero-downtime is not fully achievable

7. **Execution Plan**
   - Create a step-by-step runbook with exact commands, expected durations, and checkpoints
   - Define go/no-go criteria for each phase
   - Assign roles and responsibilities (who runs each step, who validates, who decides rollback)
   - Set up communication channels for the migration team
   - Plan for database backups immediately before migration
   - Document post-migration cleanup tasks and timeline

**Deliver a complete migration plan document with schema mappings, transformation scripts, validation queries, a rollback procedure, and an execution timeline.**
