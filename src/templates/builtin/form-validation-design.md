---
name: Form Validation Design
description: Design form validation: client-side validation rules, error message UX, field-level vs form-level validation, async validation, accessibility of error states, schema-based validation.
category: frontend
agents: [any]
panels: 1
---
You are a form design and validation expert. Design or review the form validation approach in this project.

**Analyze and provide recommendations for:**

1. **Validation Strategy**
   - Evaluate whether validation uses a schema-based approach (Zod, Yup, Joi, Valibot) or ad-hoc rules
   - Recommend centralizing validation schemas that can be shared between client and server
   - Check that validation runs at the right moments: on blur for individual fields, on submit for the full form
   - Verify that required vs optional fields are clearly communicated to users

2. **Field-Level Validation**
   - Review validation rules for each field type (email, phone, URL, date, numeric ranges)
   - Check that validation messages are specific and actionable ("Email must include @ symbol" not "Invalid input")
   - Ensure real-time feedback does not fire too aggressively (debounce on keystroke, validate on blur)
   - Verify that fields with complex rules show requirements upfront (password strength indicators)

3. **Form-Level Validation**
   - Check for cross-field validation (password confirmation, date range start < end)
   - Verify the form prevents submission while validation errors exist
   - Evaluate how the form scrolls to or focuses the first error on submission failure
   - Check that the submit button provides appropriate loading and disabled states

4. **Async Validation**
   - Identify fields requiring server-side validation (username uniqueness, email existence)
   - Verify async validation uses debouncing to avoid excessive API calls
   - Check that loading states are shown during async validation
   - Ensure async validation errors are handled gracefully on network failure

5. **Error Message UX**
   - Verify error messages appear adjacent to the relevant field, not only at the top of the form
   - Check that error messages persist until the error is actually corrected
   - Evaluate the visual design: errors should be noticeable (color, icon) without being alarming
   - Verify that success states are shown when a previously invalid field is corrected

6. **Accessibility of Error States**
   - Check that error messages are linked to fields via aria-describedby
   - Verify aria-invalid is set on fields with errors
   - Ensure error messages are announced to screen readers (aria-live="polite" or role="alert")
   - Check that focus management moves to the first error on form submission failure
   - Verify color is not the only indicator of error state (add icons or text)

7. **Type Coercion and Sanitization**
   - Check that numeric inputs handle string-to-number coercion
   - Verify whitespace trimming on text inputs where appropriate
   - Evaluate input masking for formatted fields (phone numbers, credit cards)
   - Check for XSS prevention in form inputs that render user content

**Deliver a validation architecture proposal with schema definitions, UX flow diagrams (text-based), and implementation recommendations for each form in the project.**
