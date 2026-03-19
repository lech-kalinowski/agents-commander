---
name: Retrospective Analysis
description: Analyze the codebase for retrospective insights on what went well, what needs improvement, and action items.
category: project
agents: [any]
panels: 1
---
Perform a data-driven retrospective analysis of this codebase. Instead of relying on opinions, use concrete evidence from the code, git history, and project structure to identify what went well, what needs improvement, and what actions would have the highest impact.

Analyze the following dimensions:

1. **What Went Well** - Identify evidence of good engineering practices:
   - **Clean Abstractions** - Modules with clear interfaces, low coupling, and high cohesion. Name specific files and explain what makes them well-structured.
   - **Consistent Patterns** - Areas where the team established a pattern and followed it consistently. Show examples of the pattern and how many files follow it.
   - **Good Test Coverage** - Modules with thorough, well-written tests. Highlight tests that caught real bugs or serve as excellent documentation.
   - **Effective Error Handling** - Code paths where errors are handled gracefully with good user/developer feedback.
   - **Smart Dependencies** - Libraries chosen well, used appropriately, and not over-relied upon.

2. **What Needs Improvement** - Identify concrete issues backed by evidence:
   - **Technical Debt Hotspots** - Files with the most complexity (cyclomatic complexity, line count, dependency count). Use code metrics, not subjective judgment. List the top 10 files by complexity.
   - **Churn Analysis** - If git history is available, identify files that change most frequently. High churn + high complexity = high-risk areas needing refactoring.
   - **Inconsistency** - Places where the same problem is solved in multiple different ways. Show specific examples side by side.
   - **Missing Abstractions** - Duplicated code that should be extracted. Show the duplicated blocks and suggest where the shared abstraction should live.
   - **Dependency Risks** - Outdated dependencies, unmaintained libraries, or dependencies with known vulnerabilities.
   - **Testing Gaps** - Critical code paths with no tests. Rate the risk level of each gap.

3. **Architectural Health** - Evaluate the system's structural integrity:
   - **Dependency Direction** - Do dependencies flow in one direction, or are there circular dependencies? Draw the dependency graph.
   - **Layer Violations** - Are architectural boundaries respected? Find cases where higher layers are imported by lower layers.
   - **Configuration Management** - Is config centralized or scattered? Are environment-specific values properly isolated?
   - **Scalability Concerns** - Identify patterns that will not scale well (in-memory state, synchronous processing, lack of pagination).

4. **Action Items** - Rank all findings by impact and create an actionable improvement plan:
   - **Quick Wins** (< 1 day effort, high value) - List specific changes with file paths
   - **Medium-Term** (1-5 days effort) - Refactoring tasks with clear scope
   - **Strategic** (> 1 week effort) - Architectural changes requiring planning
   For each action item, estimate the effort, describe the expected benefit, and suggest who should own it (based on the area of the codebase).

5. **Metrics Dashboard** - Summarize the codebase health with these metrics:
   - Total files / lines of code
   - Test file ratio (test files vs source files)
   - Average file size and largest files
   - Dependency count (direct and transitive)
   - Number of TODO/FIXME/HACK comments
   - Estimated technical debt score (1-10)

Keep the tone constructive and forward-looking. Every criticism must come with a specific, actionable suggestion. Focus on systemic issues rather than individual coding style preferences.
