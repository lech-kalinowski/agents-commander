---
name: Test Data Factory
description: Create test data factories and builders with realistic fake data, sensible defaults, edge case coverage, and easy customization.
category: testing
agents: [any]
panels: 1
---

Design and implement a test data factory system that produces realistic, customizable test data for the entire test suite. Follow this approach:

## Step 1: Inventory Data Models
- Identify every data model, entity, type, and interface in the codebase.
- Map relationships between models (user has many orders, order has many items, item belongs to product).
- Document required fields, optional fields, default values, and validation constraints for each model.
- Note fields with special formats: emails, URLs, phone numbers, dates, UUIDs, enums.

## Step 2: Design the Factory API
Create a factory system with these capabilities:
- **Sensible defaults**: Calling `buildUser()` with no arguments returns a fully valid user object with realistic data.
- **Override any field**: `buildUser({ name: "Custom Name" })` merges overrides with defaults.
- **Sequences**: Auto-incrementing values for unique fields (e.g., email becomes "user-1@test.com", "user-2@test.com").
- **Traits**: Named presets for common variations (e.g., `buildUser({ trait: "admin" })`, `buildUser({ trait: "deactivated" })`).
- **Relationships**: Building a parent automatically builds valid children when needed (e.g., `buildOrder()` includes a valid user reference).
- **Persistence option**: `createUser()` builds and saves to the database; `buildUser()` returns the object without saving.

## Step 3: Generate Realistic Data
For each field type, produce realistic values:
- **Names**: Use plausible but fake names, not "test" or "foo". Vary length and character sets.
- **Emails**: Derive from the generated name with a test domain (e.g., jane.doe@test.example.com).
- **Dates**: Generate dates relative to now (created 30 days ago, expires in 7 days) rather than hardcoded dates.
- **Numbers**: Use realistic ranges (price between 1.00 and 999.99, quantity between 1 and 100).
- **Enums**: Cycle through all valid enum values across factory calls to exercise all branches.
- **Text**: Use realistic-length strings with varied content, not "Lorem ipsum" everywhere.

## Step 4: Edge Case Factories
Create specific factories or traits for edge cases:
- **Minimal valid**: Only required fields, everything optional is null/undefined.
- **Maximum length**: All string fields at their maximum allowed length.
- **Unicode**: Names and text fields with unicode characters, accents, CJK characters, emoji.
- **Boundary numbers**: Zero, negative, maximum integer, maximum decimal precision.
- **Empty collections**: Entities with empty arrays/lists for has-many relationships.
- **Deep nesting**: Maximum depth of nested relationships.

## Step 5: Implementation Patterns
Use the pattern that fits the project's language and ecosystem:
- **TypeScript/JavaScript**: Use a builder pattern with method chaining, or a functional factory with spread overrides. Consider libraries like fishery or factory.ts.
- **Python**: Use factory_boy or a custom dataclass-based builder.
- **Java**: Use the builder pattern or a library like java-faker with custom builders.
- **Go**: Use functional options pattern or struct literal factories.

Ensure the factory code:
- Is fully typed so IDE autocompletion works for overrides.
- Lives in a shared test utilities directory importable by all test files.
- Does not import production code beyond type definitions.

## Step 6: Batch and Scenario Builders
Create higher-level builders for common test scenarios:
- `buildScenario.activeUserWithOrders(3)` - creates a user with 3 orders, each with items.
- `buildScenario.expiredSubscription()` - creates a user with a subscription that ended yesterday.
- `buildScenario.emptyStore()` - creates a store with no products.
- These scenario builders compose the lower-level factories.

## Step 7: Quality Checklist
- [ ] Every data model has a corresponding factory.
- [ ] Defaults produce valid objects that pass all validation rules.
- [ ] Unique fields use sequences to avoid collisions.
- [ ] Relationships are handled consistently (foreign keys, nested objects).
- [ ] Edge case traits exist for boundary testing.
- [ ] Factories are fully typed with IDE autocompletion support.
- [ ] Factory code is in a shared location importable by all test files.
- [ ] Batch/scenario builders exist for common multi-entity setups.
- [ ] Running all existing tests with factory-generated data passes.

Deliver the complete factory files, demonstrate usage examples for each model, and show how to integrate them into existing tests.
