---
name: Migration Assistant
description: Plan and execute code migrations (framework, language version, dependency upgrades)
category: single-agent
agents: [any]
panels: 1
---
Help plan and execute a code migration for this project. This could be a framework upgrade, language version migration, dependency replacement, or architectural change.

**1. Assessment Phase**
- Analyze current state (versions, dependencies, patterns in use)
- Identify what needs to change
- Map all affected files and code paths
- Check for deprecated APIs or breaking changes

**2. Migration Plan**
- Break the migration into ordered steps
- Identify dependencies between steps
- Flag high-risk changes that need extra testing
- Estimate scope of changes per step

**3. For Each Migration Step:**
- What changes are needed
- Which files are affected
- New patterns to replace old ones (with code examples)
- Tests to verify the step succeeded

**4. Rollback Strategy**
- How to revert each step if something goes wrong
- Key checkpoints to verify before proceeding

**5. Post-Migration Checklist**
- Verify all tests pass
- Check for remaining deprecated usage
- Update documentation
- Performance comparison before/after

Tell me what migration you'd like to perform, and I'll create a detailed plan.
