---
name: Architecture Decision Record
description: Write an ADR with context, decision, consequences, and alternatives considered.
category: documentation
agents: [any]
panels: 1
---
Write an Architecture Decision Record (ADR) for a technical decision in this project. Analyze the codebase to understand the current architecture and the context surrounding the decision.

Follow the standard ADR format with these sections:

1. **Title** - A short noun phrase describing the decision. Use the format "ADR-NNN: Use [Technology/Pattern] for [Purpose]". Choose a number that follows the existing ADR sequence if any exist in the project, otherwise start at ADR-001.

2. **Status** - One of: Proposed, Accepted, Deprecated, Superseded. If superseded, reference the replacing ADR. Include the date the decision was made or proposed.

3. **Context** - Describe the situation that prompted this decision. What problem are we solving? What forces are at play (technical constraints, business requirements, team skills, timeline pressure)? What is the current state of the system? Be specific with concrete details from the codebase rather than abstract statements. Reference specific files, modules, or metrics where relevant.

4. **Decision** - State the decision clearly and concisely in one or two sentences. Then elaborate on the specifics: what technology, pattern, or approach was chosen, how it will be implemented, and what the boundaries of this decision are (what it does and does not cover).

5. **Consequences** - Split into three subsections:
   - **Positive** - Benefits we gain. Be concrete: faster builds, simpler mental model, better testability, reduced coupling.
   - **Negative** - Costs and trade-offs we accept. Be honest: learning curve, migration effort, vendor lock-in, performance overhead.
   - **Neutral** - Changes that are neither good nor bad but worth noting: team will need training, monitoring setup changes, CI pipeline modifications.

6. **Alternatives Considered** - For each alternative that was seriously evaluated, describe:
   - What the alternative was
   - Its key strengths for our use case
   - Why it was ultimately not chosen
   - Under what circumstances we might reconsider it

7. **References** - Link to relevant RFCs, blog posts, benchmark results, spike findings, or internal discussions that informed the decision. Reference specific files in the codebase that are most affected.

Examine the codebase for evidence of past architectural decisions, especially in configuration files, dependency choices, directory structure, and code comments. Identify decisions that appear intentional but lack documentation, and suggest which ones would benefit most from having an ADR written.

Keep the language precise and factual. Avoid justifying decisions emotionally. A good ADR should allow a future developer to understand not just what was decided, but why, and what would need to change for the decision to be revisited.
