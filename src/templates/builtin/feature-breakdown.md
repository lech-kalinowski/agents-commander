---
name: Feature Breakdown
description: Break down a feature into implementable tasks with acceptance criteria, estimates, and dependencies.
category: project
agents: [any]
panels: 1
---
Break down a feature into concrete, implementable tasks. Analyze the existing codebase to understand how the feature fits into the current architecture and identify all the work required.

Start by understanding the feature requirements. If the requirements are vague, list clarifying questions that should be answered before implementation begins. Then proceed with the breakdown.

Structure the output as follows:

1. **Feature Summary** - One paragraph describing what the feature does from the user's perspective. Define the scope boundary explicitly: what is included and what is out of scope for this iteration.

2. **Technical Analysis** - Analyze the codebase to determine:
   - Which existing modules will be modified
   - What new modules need to be created
   - What interfaces or contracts will change
   - Which external services or APIs are involved
   - What data model changes are required (schema migrations, new tables, modified fields)

3. **Task Breakdown** - List each task with:
   - **Task ID** - Sequential identifier (T1, T2, T3...)
   - **Title** - Short, action-oriented description ("Add user preference table", "Create notification service")
   - **Description** - What exactly needs to be built or changed. Reference specific files and functions in the codebase.
   - **Acceptance Criteria** - 3-5 testable criteria in Given/When/Then format. Each criterion should be unambiguous enough that any developer can verify it.
   - **Complexity Estimate** - S (< 2 hours), M (2-8 hours), or L (1-3 days). Justify the estimate by noting what makes it simple or complex.
   - **Dependencies** - Which other tasks must be completed first. Note if any tasks can be parallelized.
   - **Risks** - Any unknowns, technical risks, or areas requiring spikes.

4. **Technical Spikes** - Identify any tasks that require research or prototyping before estimation is possible. For each spike:
   - What question needs answering
   - Suggested approach to answer it
   - Time-box recommendation
   - What decision the spike will inform

5. **Implementation Order** - Provide a recommended sequence that:
   - Respects dependencies
   - Delivers a testable increment as early as possible
   - Groups related changes to minimize context switching
   - Identifies which tasks can be parallelized across developers
   - Show this as a simple dependency graph in ASCII

6. **Testing Strategy** - For the feature as a whole:
   - What unit tests are needed
   - What integration tests are needed
   - What manual testing scenarios should be verified
   - Any performance testing requirements

7. **Rollout Considerations** - Feature flags needed, database migration ordering, backward compatibility requirements, monitoring to add, and rollback plan if something goes wrong.
