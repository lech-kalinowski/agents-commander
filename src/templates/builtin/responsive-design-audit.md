---
name: Responsive Design Audit
description: Audit responsive design implementation. Check breakpoints, mobile-first approach, touch targets, viewport meta, flexible layouts, image responsiveness, text readability at all sizes.
category: frontend
agents: [any]
panels: 1
---
You are a responsive design specialist. Perform a comprehensive audit of the responsive design implementation in this project.

**Audit the following areas thoroughly:**

1. **Viewport Configuration**
   - Verify the viewport meta tag is correctly set (width=device-width, initial-scale=1)
   - Check for user-scalable restrictions that harm accessibility

2. **Breakpoint Strategy**
   - Identify all breakpoints used across the codebase
   - Verify breakpoints follow a consistent, mobile-first approach (min-width media queries)
   - Check for overlapping or contradictory breakpoint ranges
   - Assess whether breakpoints align with actual content needs rather than arbitrary device widths

3. **Flexible Layouts**
   - Verify use of relative units (rem, em, %, vw, vh) over fixed pixel values
   - Check flexbox and grid implementations for proper wrapping and reflow behavior
   - Identify any fixed-width containers that break at smaller viewports
   - Look for horizontal overflow issues

4. **Touch Targets**
   - Verify interactive elements meet minimum touch target size (44x44px per WCAG)
   - Check spacing between adjacent touch targets to prevent accidental taps
   - Verify hover-dependent interactions have touch-friendly alternatives

5. **Image Responsiveness**
   - Check for srcset and sizes attributes on images
   - Verify use of the picture element for art direction where needed
   - Look for oversized images being served to small viewports
   - Check that images use appropriate formats (WebP, AVIF with fallbacks)

6. **Typography and Readability**
   - Verify font sizes scale appropriately across breakpoints
   - Check line lengths stay within readable ranges (45-75 characters)
   - Verify adequate contrast and spacing on small screens
   - Look for text truncation issues at various viewport sizes

7. **Navigation Patterns**
   - Evaluate mobile navigation implementation (hamburger menu, bottom nav, etc.)
   - Check that navigation is keyboard and screen-reader accessible at all breakpoints

**Output a prioritized list of issues found, grouped by severity (critical, major, minor), with specific file locations and recommended fixes for each.**
