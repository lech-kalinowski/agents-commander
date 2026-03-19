---
name: Best Practices Checklist
description: Create a comprehensive best practices checklist for the project's tech stack and grade current compliance.
category: learning
agents: [any]
panels: 1
---
Create a comprehensive best practices checklist tailored to this project's specific tech stack and domain. Audit the codebase against each item and grade current compliance.

Analyze the project's technologies, frameworks, and tools first. Then evaluate each category:

1. **Code Style & Consistency** - Check for:
   - [ ] Linter configured and enforced (ESLint, Pylint, Clippy, etc.)
   - [ ] Formatter configured and consistent (Prettier, Black, gofmt, etc.)
   - [ ] Naming conventions documented and followed
   - [ ] File and directory organization follows clear conventions
   - [ ] Import ordering and grouping is consistent
   - [ ] Dead code and unused imports are removed
   - [ ] No commented-out code blocks left in production files
   - Grade: A/B/C/D/F with specific findings

2. **Error Handling** - Check for:
   - [ ] All errors are caught and handled appropriately
   - [ ] Error messages are informative and actionable
   - [ ] No silent error swallowing (empty catch blocks)
   - [ ] Error boundaries exist at architectural boundaries
   - [ ] User-facing errors are distinct from developer errors
   - [ ] Errors include context for debugging (stack trace, request ID, input data)
   - Grade: A/B/C/D/F with specific findings

3. **Testing** - Check for:
   - [ ] Unit tests exist for core business logic
   - [ ] Integration tests exist for critical paths
   - [ ] Test coverage meets or exceeds project threshold
   - [ ] Tests are deterministic (no flaky tests)
   - [ ] Mocking strategy is consistent and not excessive
   - [ ] Edge cases and error paths are tested
   - [ ] Test names describe behavior, not implementation
   - Grade: A/B/C/D/F with specific findings

4. **Security** - Check for:
   - [ ] No secrets hardcoded in source code
   - [ ] Input validation on all external inputs
   - [ ] SQL injection / NoSQL injection prevention
   - [ ] XSS prevention (if applicable)
   - [ ] Authentication and authorization properly implemented
   - [ ] Dependencies scanned for known vulnerabilities
   - [ ] HTTPS enforced, secure headers configured
   - Grade: A/B/C/D/F with specific findings

5. **Performance** - Check for:
   - [ ] No N+1 query patterns
   - [ ] Appropriate use of caching
   - [ ] Pagination for large data sets
   - [ ] Async operations used where beneficial
   - [ ] No memory leaks (event listener cleanup, stream closing)
   - [ ] Bundle size / binary size is reasonable
   - Grade: A/B/C/D/F with specific findings

6. **Accessibility** (if applicable) - Check for:
   - [ ] Semantic HTML and ARIA labels
   - [ ] Keyboard navigation support
   - [ ] Screen reader compatibility
   - [ ] Color contrast ratios meet WCAG standards
   - Grade: A/B/C/D/F with specific findings

7. **Documentation** - Check for:
   - [ ] README with setup instructions exists and is current
   - [ ] API documentation exists (if applicable)
   - [ ] Complex functions have doc comments
   - [ ] Architecture decisions are documented
   - [ ] Environment variables are documented
   - Grade: A/B/C/D/F with specific findings

Provide an overall compliance score as a percentage. Prioritize the top 10 action items by impact (high-impact, low-effort items first). For each action item, specify the file(s) to change and what the fix looks like.
