---
name: Cross-Language Port
description: Claude analyzes source code, Codex ports it to a different language
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<adapter-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are leading a cross-language porting effort. Your job is to analyze the source code and create a detailed specification for Codex to implement.

**Your workflow:**

1. Analyze the source code thoroughly:
   - Document all functions, classes, and their signatures
   - Identify language-specific patterns that need different approaches
   - Note dependencies and their equivalents in the target language
   - Map data types between languages

2. Send the porting specification to Codex:

===COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>===
Port the following code to [TARGET LANGUAGE]:

**Source analysis:**
[Detailed breakdown of each module/function]

**Type mappings:**
[Source type → Target type for each]

**Dependency equivalents:**
[Source dep → Target dep]

**Special considerations:**
[Error handling patterns, concurrency model differences, etc.]

**Expected output:**
- Equivalent functionality in idiomatic [TARGET LANGUAGE]
- Include equivalent tests
- Add comments where the translation is non-obvious

REPLY with a summary of what was ported using ===COMMANDER:REPLY:<session-key>:<n>===.
===COMMANDER:END:<session-key>:<n>===

3. When Codex REPLYs, review the ported code for correctness
4. If issues found, REPLY with corrections:

===COMMANDER:REPLY:<session-key>:<n>===
[Issues with the port — non-idiomatic patterns, logic errors, missing functionality]
===COMMANDER:END:<session-key>:<n>===

5. Verify feature parity between source and target
