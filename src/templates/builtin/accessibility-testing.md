---
name: Accessibility Testing
description: Audit and test for WCAG 2.1 compliance including semantic HTML, ARIA attributes, keyboard navigation, screen reader compatibility, and color contrast.
category: testing
agents: [any]
panels: 1
---

Perform a comprehensive accessibility audit and create automated tests to verify WCAG 2.1 AA compliance. Follow this structured methodology:

## Step 1: Automated Accessibility Scan
- Run an automated accessibility scanner across all pages and components.
- Use axe-core, pa11y, Lighthouse accessibility audit, or equivalent tooling.
- Categorize findings by WCAG success criterion (e.g., 1.1.1 Non-text Content, 2.1.1 Keyboard, 4.1.2 Name Role Value).
- Record severity: critical (blocks users), serious (major difficulty), moderate (some difficulty), minor (best practice).

## Step 2: Semantic HTML Audit
Review all templates, components, and pages for:
- **Heading hierarchy**: Exactly one h1 per page, headings in sequential order without skipping levels.
- **Landmark regions**: Proper use of header, nav, main, aside, footer elements.
- **Lists**: Related items use ul/ol/dl, not divs with visual styling.
- **Tables**: Data tables have th elements with scope, caption or aria-label for table purpose.
- **Forms**: Every input has an associated label (explicit via for/id or implicit wrapping). Required fields are programmatically indicated, not just visually.
- **Links vs buttons**: Links navigate, buttons perform actions. No div or span elements used as interactive controls.

## Step 3: ARIA Attribute Review
- Verify ARIA roles are used only when native HTML semantics are insufficient.
- Check that custom interactive widgets (dropdowns, modals, tabs, accordions) have correct ARIA roles, states, and properties.
- Validate aria-live regions for dynamic content updates (notifications, loading states, error messages).
- Ensure aria-label and aria-labelledby values are meaningful and not redundant with visible text.
- Confirm aria-hidden is not applied to focusable or interactive elements.

## Step 4: Keyboard Navigation Testing
Test every interactive element and workflow:
- [ ] All interactive elements are reachable via Tab key in logical order.
- [ ] Focus indicator is visible on every focusable element (minimum 2px outline, 3:1 contrast ratio).
- [ ] Modal dialogs trap focus (Tab cycles within the modal, Escape closes it).
- [ ] Dropdown menus support arrow keys for navigation and Escape to close.
- [ ] Skip navigation link is present and works to bypass repetitive content.
- [ ] No keyboard traps exist (user can always Tab away from any element).
- [ ] Custom shortcuts do not conflict with screen reader shortcuts.

## Step 5: Color and Visual Testing
- **Contrast ratios**: Normal text has at least 4.5:1 contrast, large text at least 3:1 (WCAG AA).
- **Color independence**: Information is not conveyed by color alone (use icons, patterns, or text labels alongside color).
- **Motion**: Animations respect prefers-reduced-motion media query. No auto-playing content that cannot be paused.
- **Zoom**: Page is usable at 200% zoom without horizontal scrolling or content overlap.
- **Text spacing**: Content remains readable with increased letter spacing (0.12em), word spacing (0.16em), and line height (1.5).

## Step 6: Screen Reader Compatibility
Verify with at least one screen reader (VoiceOver on macOS, NVDA on Windows, or via automated tools):
- Page title announces the current page or view.
- Dynamic content changes are announced via aria-live regions.
- Form errors are associated with their fields and announced when they appear.
- Images have meaningful alt text (or empty alt for decorative images).
- Interactive elements announce their name, role, and state.

## Step 7: Write Automated Accessibility Tests
Create tests that run in CI to prevent regressions:
- Integrate axe-core with the testing framework (jest-axe, cypress-axe, playwright axe).
- Write a test for each page and each component in its major states.
- Test keyboard navigation flows programmatically (focus management, tab order).
- Assert that no critical or serious axe violations exist.

## Step 8: Deliverables Checklist
- [ ] Automated scan results documented with findings per WCAG criterion.
- [ ] Semantic HTML issues listed with specific file locations and fixes.
- [ ] ARIA misuse corrected with before/after code.
- [ ] Keyboard navigation verified for all interactive workflows.
- [ ] Color contrast verified for all text and interactive elements.
- [ ] Automated accessibility tests added to the test suite and passing.
- [ ] Remediation plan created for any issues that cannot be fixed immediately.

Deliver the fixes for all identified issues, the new automated accessibility test files, and a summary of remaining items that require manual testing.
