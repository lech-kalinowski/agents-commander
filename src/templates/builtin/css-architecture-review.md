---
name: CSS Architecture Review
description: Review CSS organization: methodology (BEM, CSS Modules, Tailwind), specificity management, dead CSS removal, responsive patterns, custom properties usage, animation performance.
category: frontend
agents: [any]
panels: 1
---
You are a CSS architecture expert. Review the CSS organization and patterns in this project.

**Evaluate the following areas:**

1. **Methodology and Naming**
   - Identify the CSS methodology in use (BEM, CSS Modules, Tailwind, styled-components, etc.)
   - Check for consistency in naming conventions across the codebase
   - Look for naming collisions or overly generic class names
   - Evaluate whether the chosen methodology is applied consistently or if multiple approaches are mixed

2. **Specificity Management**
   - Identify high-specificity selectors (nested IDs, !important overrides)
   - Check for specificity wars where selectors escalate to override each other
   - Look for overly qualified selectors (div.classname, ul > li.item)
   - Recommend flattening selector chains to reduce specificity conflicts

3. **Dead CSS Detection**
   - Identify unused CSS rules that can be safely removed
   - Look for styles targeting elements or classes that no longer exist in the markup
   - Check for duplicated rule blocks or redundant property declarations
   - Evaluate if CSS file sizes could be significantly reduced

4. **Custom Properties (CSS Variables)**
   - Assess use of CSS custom properties for theming and design tokens
   - Check for hardcoded values (colors, spacing, font sizes) that should be variables
   - Verify custom property naming follows a consistent convention
   - Evaluate fallback values for custom properties

5. **Responsive Patterns**
   - Check for consistent breakpoint values (preferably using custom properties or preprocessor variables)
   - Verify mobile-first media query approach
   - Look for container query opportunities where appropriate
   - Identify duplicated responsive logic that could be consolidated

6. **Animation and Transitions**
   - Verify animations use GPU-accelerated properties (transform, opacity) instead of layout-triggering properties (top, left, width, height)
   - Check for will-change usage and potential overuse
   - Look for janky animations caused by animating expensive properties
   - Evaluate prefers-reduced-motion support for accessibility

7. **Architecture and File Organization**
   - Assess CSS file structure: is it organized by component, feature, or layer?
   - Check for proper separation of base/reset styles, layout, components, and utilities
   - Evaluate import order and cascade management
   - Look for circular dependencies or import order issues

8. **Preprocessor / PostCSS Usage**
   - Review nesting depth (recommend max 3 levels)
   - Check for overuse of mixins or extends that bloat output
   - Evaluate if preprocessor features are used where native CSS would suffice
   - Verify source maps are configured for debugging

**Provide a summary of findings with specific file references, a refactoring plan organized by priority, and estimated effort for each improvement.**
