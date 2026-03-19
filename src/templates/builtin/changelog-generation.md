---
name: Changelog Generation
description: Generate a changelog from git history and code changes following Keep a Changelog format.
category: documentation
agents: [any]
panels: 1
---
Generate a well-structured changelog by analyzing the git history and code changes in this project. Follow the Keep a Changelog format (https://keepachangelog.com/).

Start by examining the git log, commit messages, merged pull requests, and tags to understand the release history and what has changed.

Organize entries under these categories, in this order:

1. **Added** - New features and capabilities. Describe what the user or developer can now do that they could not before. Reference the relevant module or component.

2. **Changed** - Modifications to existing functionality. Explain what behaves differently and why. If a public API signature changed, show the before and after.

3. **Deprecated** - Features that still work but are scheduled for removal. State when they will be removed and what the replacement is.

4. **Removed** - Features or APIs that have been deleted. If this was previously deprecated, reference when the deprecation was announced.

5. **Fixed** - Bug fixes. Describe the symptom the user experienced, not the implementation detail. Reference issue numbers if available.

6. **Security** - Vulnerability fixes and security improvements. Include CVE numbers if applicable. Note the severity level.

7. **Performance** - Measurable performance improvements. Include before/after metrics where available (response time, memory usage, bundle size).

For breaking changes, add a prominent **BREAKING** prefix to the entry. Collect all breaking changes into a dedicated migration section at the top of the release notes with step-by-step upgrade instructions:
- What code needs to change
- Search-and-replace patterns where applicable
- Configuration file changes
- Database migration steps
- Environment variable changes

Format each release with the version number and date: `## [1.2.0] - 2025-01-15`. Use `## [Unreleased]` for changes not yet in a release.

Write entries from the user's perspective, not the developer's. Say "Users can now filter results by date" not "Added DateFilter component to SearchResults". Keep entries concise but specific enough to be actionable.

If commit messages are unclear or inconsistent, analyze the actual code diffs to determine what changed and categorize appropriately. Flag any changes that seem significant but have poor or missing commit messages.

At the end, provide a summary of the overall release theme and highlight the most impactful changes.
