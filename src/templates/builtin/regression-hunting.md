---
name: Regression Hunting
description: Systematic approach to finding when a regression was introduced. Use git bisect strategy, identify suspect commits, narrow down the changeset, verify the fix, add a regression test.
category: debugging
agents: [any]
panels: 1
---

Systematically find when and why a regression was introduced into this project. Use a structured approach to narrow down the offending change.

## Step 1: Define the Regression
- Clearly describe the expected behavior (what used to work) and the current broken behavior.
- Identify the last known good version or date when the feature worked correctly.
- Create a reliable, fast test or verification step that distinguishes working from broken.
- Ensure the reproduction is deterministic: the same commit should always produce the same result.
- Document the exact steps to reproduce so the test can be automated.

## Step 2: Establish Boundaries
- Identify a known good commit (the feature definitely works here).
- Identify a known bad commit (the feature is definitely broken here, typically HEAD).
- Verify both commits by running the reproduction test against each.
- If the known good commit is very old, try to narrow the range first by testing midpoint releases or tags.
- Note the number of commits in the range to estimate how many bisect steps are needed.

## Step 3: Git Bisect Strategy
- Use `git bisect start`, `git bisect good <good-commit>`, `git bisect bad <bad-commit>`.
- At each step, run the reproduction test and mark the commit as `git bisect good` or `git bisect bad`.
- If a commit cannot be tested (build failure, unrelated breakage), use `git bisect skip`.
- For automated bisection, use `git bisect run <test-script>` with a script that exits 0 for good, 1 for bad, and 125 for skip.
- The bisect process will converge on the first bad commit in O(log n) steps.

## Step 4: Analyze the Offending Commit
- Once the first bad commit is identified, examine it thoroughly with `git show <commit>`.
- Read the commit message for context on what the change intended to do.
- Review every changed file and understand how each change could cause the regression.
- Check if the change is a direct cause or if it exposed a latent bug.
- Look at related commits (same PR or branch) for additional context.

## Step 5: Understand the Root Cause
- Determine why the change broke the expected behavior:
  - Logic error in the new code?
  - Removed or changed behavior that other code depended on?
  - Side effect of a refactoring that altered subtle behavior?
  - Dependency upgrade with breaking changes?
  - Configuration change with unintended consequences?
- Check if the original change had test coverage. If so, why did the tests not catch the regression?
- Identify if multiple commits contributed to the regression (partial changes across commits).

## Step 6: Fix and Prevent
- Write the fix that restores the expected behavior without reverting the intended improvement.
- If the intended change and the regression are inseparable, discuss alternatives with the team.
- Write a regression test that specifically tests the scenario that broke.
- The regression test should fail on the bad commit and pass on the fix.
- Add a comment in the test referencing the original issue or commit for future context.
- Review related code paths for similar latent issues that the same type of change could expose.

Run `git bisect reset` when finished to restore the working tree to its original state.
