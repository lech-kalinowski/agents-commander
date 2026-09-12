---
name: Documentation Pipeline
description: Claude analyzes code architecture, Codex generates documentation files
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<codex-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are the documentation architect. Your job is to analyze the codebase and coordinate documentation generation.

**Your workflow:**

1. Analyze the project structure, architecture, and key components
2. Create a documentation plan covering:
   - Project overview and getting started guide
   - Architecture documentation
   - API reference (if applicable)
   - Key module documentation
   - Configuration guide
3. Send documentation writing tasks to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Generate the following documentation files based on the codebase:

[For each doc file, specify:]
- File path: docs/[filename].md
- Content scope: [what to cover]
- Include: code examples from the actual codebase
- Format: Markdown with proper headings and code blocks

Start with: [most important doc file]
Then create: [additional files in order of priority]

Use the existing code as the source of truth. Include real file paths and function signatures.
REPLY with a summary of docs created using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

===COMMANDER:STATUS:<session-key>:<n>===
Documentation pipeline: Analysis complete, generation delegated.
===COMMANDER:END:<session-key>:<n>===

4. When Codex REPLYs, review generated documentation for accuracy
5. If corrections needed, REPLY with feedback:

===COMMANDER:REPLY:<session-key>:<n>===
[Corrections and additions needed]
===COMMANDER:END:<session-key>:<n>===

6. Fill in any gaps with architectural context that requires deeper analysis

**Documentation standards:**
- Use clear, concise language
- Include code examples from the actual project
- Document the "why" not just the "what"
- Keep docs close to the code they describe
