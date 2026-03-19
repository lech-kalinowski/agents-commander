---
name: Root Cause Analysis
description: Systematic root cause analysis for a bug. Reproduce the issue, trace the code path, examine data flow, check recent changes (git log), test hypotheses, identify the fundamental cause vs symptoms.
category: debugging
agents: [any]
panels: 1
---

Perform a systematic root cause analysis for the reported bug. Do not jump to conclusions. Follow a structured diagnostic process.

## Step 1: Understand and Reproduce the Issue
- Gather all available information: error messages, stack traces, screenshots, reproduction steps.
- Identify the expected behavior versus the actual behavior.
- Determine the scope: does this affect all users, specific inputs, certain environments, or particular timing conditions?
- Reproduce the issue locally with a minimal test case. If you cannot reproduce, document what you tried and why it may be environment-specific.
- Note whether the issue is deterministic or intermittent.

## Step 2: Trace the Code Path
- Starting from the entry point (API endpoint, UI action, event handler), trace the execution path.
- Read each function in the call chain, noting transformations applied to the data.
- Identify branching conditions and determine which branches execute for the failing case.
- Check error handling along the path: are exceptions caught and swallowed? Are errors logged?
- Look for implicit assumptions in the code (null checks missing, type coercions, default values).

## Step 3: Examine Data Flow
- Track the data from its source (user input, database, external API) through each transformation.
- Identify where the data diverges from expectations. Log or inspect intermediate values.
- Check data validation at boundaries: is invalid data entering the system upstream?
- Verify database queries return expected results. Check for stale caches or race conditions.
- Examine serialization and deserialization steps for data corruption.

## Step 4: Check Recent Changes
- Review the git log to identify recent commits to the affected code and its dependencies.
- Use `git log --oneline --since="2 weeks ago" -- <affected files>` to narrow the timeline.
- Check if the issue correlates with a specific deployment, dependency upgrade, or configuration change.
- Review any recent changes to shared utilities, middleware, or infrastructure.
- If a suspect commit is found, verify with `git bisect` or by testing the previous version.

## Step 5: Test Hypotheses
- Formulate specific, falsifiable hypotheses about the root cause.
- For each hypothesis, design a test that would confirm or refute it.
- Start with the most likely hypothesis and work through them systematically.
- Do not stop at the first fix that makes the symptom disappear. Verify it addresses the root cause.
- Check for multiple contributing factors that may need separate fixes.

## Step 6: Document Findings
- Clearly state the root cause, distinguishing it from symptoms.
- Explain the chain of causation: what triggered it, why the code behaved incorrectly, why it was not caught earlier.
- Provide the fix with an explanation of why it addresses the root cause.
- Write a regression test that would catch this specific bug if it were reintroduced.
- Recommend preventive measures (better validation, additional tests, monitoring, code review focus areas).
