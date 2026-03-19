---
name: Snapshot Test Setup
description: Set up and review snapshot tests for UI components or API responses, handling dynamic values and distinguishing snapshot-appropriate vs explicit assertion targets.
category: testing
agents: [any]
panels: 1
---

Set up snapshot testing for the project, identifying where snapshots add value and where explicit assertions are more appropriate. Follow this approach:

## Step 1: Identify Snapshot Candidates
Analyze the codebase to classify what should and should not use snapshot testing:

**Good candidates for snapshots**:
- UI component rendered output (HTML/JSX structure).
- Serialized API response shapes for regression detection.
- Generated code, config files, or templates.
- Complex object structures where writing individual assertions would be unwieldy.
- CLI output formatting.

**Better suited for explicit assertions**:
- Specific computed values or business logic results.
- Error messages that must match exact strings.
- Single boolean or numeric return values.
- Anything where a snapshot failure would not clearly indicate what broke.

## Step 2: Handle Dynamic Values
Identify and neutralize values that change between test runs:
- **Timestamps**: Replace with fixed dates or use a deterministic clock mock.
- **UUIDs/IDs**: Replace with placeholder strings using serializer transforms or regex matchers.
- **Random values**: Seed random number generators for deterministic output.
- **File paths**: Normalize platform-specific path separators.
- **Environment-specific data**: Mock hostnames, ports, and environment variables.

Configure snapshot serializers to automatically handle these dynamic fields rather than relying on ad-hoc replacements in each test.

## Step 3: Write Snapshot Tests
For each identified candidate:
- Render or produce the output in a test.
- Apply dynamic value normalization.
- Call the snapshot assertion (toMatchSnapshot, assert_match_snapshot, etc.).
- Name the snapshot descriptively so the snapshot file is navigable.

For UI components specifically:
- Test each meaningful state: default, loading, error, empty, populated.
- Test with different prop combinations that affect structure (not just styling).
- Use shallow rendering when deep rendering would make snapshots too large and fragile.

## Step 4: Snapshot Maintenance Strategy
Establish team practices for snapshot management:
- Snapshot files must be committed to version control alongside the test.
- Reviews of snapshot changes must verify the diff is intentional and correct.
- Large snapshot diffs (more than 20 lines changed) should be reviewed carefully for unintended regressions.
- Periodically audit snapshot files and delete orphaned snapshots.

## Step 5: Inline vs External Snapshots
Decide per test:
- **Inline snapshots**: Use for small outputs (under 10 lines) where seeing the expected value in the test file aids readability.
- **External snapshots**: Use for larger outputs where inline values would obscure the test logic.

## Step 6: Quality Checklist
- [ ] Snapshot candidates are classified and justified.
- [ ] Dynamic values are normalized via serializers, not ad-hoc replacements.
- [ ] Each snapshot test covers one logical component state or output.
- [ ] Snapshot files are committed and reviewed alongside code changes.
- [ ] UI components are tested at appropriate render depth (shallow vs deep).
- [ ] Snapshot tests complement, not replace, explicit behavioral assertions.
- [ ] Orphaned snapshots are identified and cleaned up.

Generate all snapshot test files and their initial snapshot baselines. Run the suite to confirm all snapshots match.
