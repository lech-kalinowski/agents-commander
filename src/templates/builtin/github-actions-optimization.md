---
name: GitHub Actions Optimization
description: Optimize GitHub Actions workflows. Reduce execution time with caching, parallelization, conditional steps. Add proper matrix testing, artifact management, and reusable workflows.
category: devops
agents: [any]
panels: 1
---

Review and optimize all GitHub Actions workflows in this project for speed, reliability, and maintainability.

## Step 1: Workflow Audit
- Inventory all workflow files in `.github/workflows/`.
- Map out trigger events (push, pull_request, schedule, workflow_dispatch) and their filters.
- Identify the total execution time, most time-consuming jobs, and most frequently run workflows.
- Check for redundant workflows that run the same checks on overlapping triggers.

## Step 2: Caching Strategy
- Implement dependency caching for package managers (npm, pip, Maven, Go modules) using `actions/cache` or built-in caching in setup actions.
- Cache build outputs (compiled binaries, webpack bundles, Docker layers) between runs.
- Use proper cache keys with hash of lock files for automatic invalidation.
- Set up fallback restore keys for partial cache hits.
- Verify cache hit rates and remove caches that rarely hit.

## Step 3: Parallelization and Job Structure
- Split sequential steps into parallel jobs where there are no dependencies.
- Use `needs` to express only real job dependencies, allowing maximum parallelism.
- Move expensive setup (checkout, install) into reusable composite actions to avoid duplication.
- Consider splitting large test suites using matrix strategy or test sharding.
- Use `concurrency` groups to cancel redundant in-progress runs on the same branch.

## Step 4: Matrix Testing
- Define matrix strategies for multi-version testing (Node 18/20/22, Python 3.10/3.11/3.12).
- Use `fail-fast: false` when you need results from all combinations, `fail-fast: true` for quick feedback.
- Apply `include` and `exclude` to handle platform-specific variations without full matrix explosion.
- Consider running the full matrix only on main branch, with a minimal subset on pull requests.

## Step 5: Conditional Execution
- Add path filters to skip workflows unaffected by changes (`paths`, `paths-ignore`).
- Use `if` conditions to skip expensive jobs when only docs or config files changed.
- Implement `dorny/paths-filter` or similar for fine-grained job-level path filtering.
- Skip redundant checks on draft pull requests unless explicitly requested.

## Step 6: Reusable Workflows and Composite Actions
- Extract common job sequences into reusable workflows (`workflow_call` trigger).
- Create composite actions for repeated step sequences (setup, build, deploy).
- Centralize version pinning of third-party actions in one place.
- Pin all actions to specific SHA commits for security, not just version tags.

## Step 7: Artifact and Output Management
- Use `actions/upload-artifact` and `actions/download-artifact` to share build outputs between jobs.
- Set appropriate retention days to control storage costs.
- Use job outputs to pass small values between dependent jobs instead of artifacts.
- Compress large artifacts before upload.

## Step 8: Security and Maintenance
- Verify `GITHUB_TOKEN` permissions are scoped to minimum required (`permissions` block).
- Check that secrets are not exposed in logs (use masking, avoid printing env).
- Set up Dependabot or Renovate to keep action versions updated.
- Add workflow status badges to the repository README.

Provide the optimized workflow files with comments explaining each optimization. Include before/after execution time estimates where possible.
