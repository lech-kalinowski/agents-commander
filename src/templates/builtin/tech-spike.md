---
name: Tech Spike
description: Conduct a technical spike researching options, comparing approaches, and providing a justified recommendation.
category: project
agents: [any]
panels: 1
---
Conduct a thorough technical spike to evaluate options for a technical decision. Research, prototype, and compare approaches to arrive at a well-justified recommendation.

Structure the spike as follows:

1. **Problem Statement** - Define the technical problem clearly. What capability does the project need? What constraints exist (performance targets, compatibility requirements, team expertise, budget, timeline)? What does success look like?

2. **Current State** - Analyze the existing codebase to understand:
   - How is this problem currently handled (if at all)?
   - What existing patterns, libraries, and infrastructure are in place?
   - What integration points will the chosen solution need to connect with?
   - What technical debt or limitations exist that the solution should address?

3. **Options Evaluated** - For each viable option (aim for 3-5), provide:
   - **Name and Version** - The specific technology, library, or approach
   - **Overview** - What it is and how it works in 2-3 sentences
   - **Proof of Concept** - Describe a minimal prototype or code sample showing how this option would integrate with the existing codebase. Include actual code snippets demonstrating the integration pattern.
   - **Strengths** - Concrete advantages for this specific project (not generic marketing points)
   - **Weaknesses** - Honest downsides, limitations, and risks
   - **Community and Ecosystem** - GitHub stars/activity (as a rough proxy for adoption), npm/PyPI downloads, last release date, number of open issues, quality of documentation, available plugins/extensions

4. **Comparison Matrix** - Create a table comparing all options across these dimensions:
   - **Performance** - Benchmarks if available, theoretical analysis if not
   - **Maintainability** - Code clarity, abstraction quality, upgrade path
   - **Learning Curve** - Time for the team to become productive
   - **Community Support** - Documentation, Stack Overflow answers, active maintenance
   - **Integration Effort** - How much existing code needs to change
   - **Long-term Viability** - Is it actively maintained? Corporate backing? Risk of abandonment?
   - **License** - Compatibility with the project's license
   Rate each dimension as Strong / Adequate / Weak with a brief justification.

5. **Risk Analysis** - For each option, identify:
   - What could go wrong during implementation
   - What could go wrong in production
   - Vendor lock-in concerns
   - Migration difficulty if we need to switch later

6. **Recommendation** - State the recommended option clearly. Explain:
   - Why it is the best fit for this specific project and team
   - What trade-offs we are accepting
   - What mitigation strategies address the known weaknesses
   - What conditions would cause us to reconsider this decision
   - Concrete next steps to implement the recommendation

7. **Decision Checklist** - Before finalizing, verify:
   - [ ] At least 3 options were seriously evaluated
   - [ ] A working prototype exists for the recommended option
   - [ ] Performance has been measured, not assumed
   - [ ] The team has the skills or a plan to acquire them
   - [ ] License is compatible
   - [ ] A rollback plan exists
