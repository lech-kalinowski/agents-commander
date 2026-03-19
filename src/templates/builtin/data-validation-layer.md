---
name: Data Validation Layer
description: Design data validation: input schemas (Zod, Joi, etc.), validation at system boundaries, sanitization rules, custom validators, validation error reporting, type coercion rules.
category: data
agents: [any]
panels: 1
---
You are a data validation architect. Design or review the data validation layer for this project.

**Address the following areas:**

1. **Validation Library and Schema Definition**
   - Evaluate and recommend a validation library (Zod, Joi, Yup, Valibot, ArkType, class-validator, etc.)
   - Define validation schemas for all external inputs: API request bodies, query parameters, form submissions, file uploads
   - Ensure schemas serve as the single source of truth for both validation and TypeScript types
   - Organize schemas by domain (user schemas, order schemas, etc.) in a dedicated directory
   - Reuse and compose schemas: base schemas extended for create/update/patch operations

2. **Validation at System Boundaries**
   - Validate at every system boundary: API endpoints, message queue consumers, file imports, webhook handlers
   - Reject invalid data as early as possible, before it reaches business logic
   - Implement middleware or decorators that automatically validate request payloads against schemas
   - Validate environment variables and configuration at application startup
   - Check external API responses against expected schemas to catch upstream changes

3. **Type Coercion Rules**
   - Define explicit coercion rules: string-to-number for query parameters, string-to-date, string-to-boolean
   - Handle common coercion edge cases: "0" and "false" as boolean false, empty strings vs null
   - Implement coercion at the schema level so business logic receives correctly typed values
   - Document coercion behavior for each field type to avoid surprises
   - Ensure coercion is deterministic and well-tested

4. **Sanitization**
   - Trim whitespace from string inputs by default
   - Sanitize HTML content to prevent XSS (use allowlists, not blocklists)
   - Normalize Unicode text (NFC normalization for consistent comparisons)
   - Strip or escape control characters from text inputs
   - Validate and sanitize file upload names, MIME types, and content
   - Implement SQL injection prevention at the ORM/query builder level, not the validation layer

5. **Custom Validators**
   - Build reusable validators for domain-specific rules:
     - Email format validation with optional MX record checking
     - Phone number validation with libphonenumber or equivalent
     - URL validation with protocol, domain, and path checks
     - Credit card number validation with Luhn algorithm
     - Business-specific rules (order total > 0, date ranges, enum values)
   - Implement cross-field validation (end date after start date, password confirmation match)
   - Support async validators for rules requiring database or API lookups (unique email, valid coupon code)

6. **Validation Error Reporting**
   - Return structured error responses with:
     - Field path (e.g., "address.zipCode" for nested objects)
     - Error code (machine-readable, e.g., "too_short", "invalid_format")
     - Human-readable message (localizable)
     - Expected value constraints (minimum, maximum, pattern)
   - Collect all validation errors at once (do not fail on the first error)
   - Format errors consistently across all API endpoints
   - Support localization of error messages via error codes
   - Map internal validation errors to appropriate HTTP status codes (400, 422)

7. **Testing Validation**
   - Write unit tests for every validation schema covering:
     - Valid inputs (happy path)
     - Missing required fields
     - Invalid types and formats
     - Boundary values (min/max length, numeric ranges)
     - Edge cases (empty strings, null, undefined, special characters)
   - Test coercion rules explicitly
   - Test custom validators in isolation
   - Implement property-based testing for complex validation rules
   - Test validation error message format and content

8. **Performance Considerations**
   - Profile validation performance for complex or large schemas
   - Consider lazy schema compilation for applications with many schemas
   - Cache compiled schemas to avoid repeated parsing overhead
   - Implement request size limits before validation to prevent DoS
   - Use streaming validation for large file uploads or batch imports

**Deliver a validation architecture document with schema organization, code examples for each validation pattern, error format specification, and a testing strategy.**
