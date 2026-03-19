---
name: API Versioning Strategy
description: Design an API versioning strategy. Evaluate approaches, plan backward compatibility, deprecation timelines, migration guides, and client notification.
category: architecture
agents: [any]
panels: 1
---
Design a comprehensive API versioning strategy for this project. Analyze the current API surface and produce an actionable versioning plan.

## Step 1: Current API Surface Audit
- Inventory all public API endpoints, their consumers, and usage patterns.
- Classify endpoints by stability: stable (rarely changes), evolving (active development), experimental (likely to change).
- Identify existing breaking change risks: field removals, type changes, behavioral changes, renamed endpoints.
- Document current versioning practices (if any) and their limitations.

## Step 2: Versioning Approach Evaluation
Evaluate each approach against the project's specific needs and recommend one:
- **URI Path Versioning** (`/v1/resource`): Explicit, easy to route, but pollutes URLs and complicates client code. Best for public APIs with many external consumers.
- **Header Versioning** (`Accept-Version: v2`): Clean URLs, flexible, but less discoverable and harder to test in browsers. Best for internal or partner APIs.
- **Content Negotiation** (`Accept: application/vnd.api.v2+json`): Most RESTful, supports granular versioning, but complex to implement. Best for APIs needing per-resource versioning.
- **Query Parameter** (`?version=2`): Simple, easy to test, but clutters query strings. Best for quick iteration during development.

Provide a clear recommendation with rationale based on: consumer types, team size, API maturity, and tooling ecosystem.

## Step 3: Backward Compatibility Rules
Define explicit rules for what constitutes a breaking vs. non-breaking change:
- **Non-breaking (minor version)**: Adding optional fields, new endpoints, new enum values (additive only), adding optional query parameters.
- **Breaking (major version)**: Removing fields, changing field types, renaming endpoints, changing authentication, altering error formats, changing default behavior.
- **Compatibility enforcement**: Design automated contract tests or schema validation that runs in CI to prevent accidental breaking changes.

## Step 4: Deprecation Lifecycle
Design a structured deprecation process:
1. **Announcement**: How consumers are notified (response headers, changelog, developer portal, email).
2. **Deprecation period**: Minimum time between deprecation notice and removal (recommend 6-12 months for public APIs).
3. **Sunset headers**: Implement `Sunset` and `Deprecation` HTTP headers per RFC 8594.
4. **Usage monitoring**: Track deprecated endpoint usage to identify consumers who have not migrated.
5. **Removal**: Final removal process with pre-removal notifications at 90, 30, and 7 days.

## Step 5: Migration Support
- Produce migration guides for each version transition with before/after examples.
- Provide SDK or client library versioning aligned with API versions.
- Offer a compatibility mode or translation layer that allows old requests to be transformed to the new version where feasible.
- Design a version negotiation mechanism so clients can discover available versions.

## Step 6: Implementation Plan
Deliver:
1. Recommended versioning scheme with technical implementation details (routing, middleware, serialization).
2. Version lifecycle policy document (template provided).
3. CI/CD integration plan for contract testing and breaking change detection.
4. Monitoring dashboard requirements: version adoption rates, deprecated endpoint usage, error rates by version.
5. Timeline for applying the strategy to existing endpoints.
