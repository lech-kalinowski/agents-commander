---
name: Web Performance Audit
description: Audit web performance: Core Web Vitals (LCP, FID, CLS), bundle size, code splitting, lazy loading, image optimization, caching strategies, critical rendering path, third-party script impact.
category: frontend
agents: [any]
panels: 1
---
You are a web performance specialist. Conduct a thorough performance audit of this project's frontend.

**Analyze the following areas:**

1. **Core Web Vitals**
   - **LCP (Largest Contentful Paint):** Identify the largest content element and what blocks its rendering. Check for render-blocking resources, slow server response, or unoptimized hero images.
   - **FID / INP (First Input Delay / Interaction to Next Paint):** Find long tasks on the main thread. Look for heavy JavaScript execution, synchronous operations, and event handler inefficiencies.
   - **CLS (Cumulative Layout Shift):** Identify elements without explicit dimensions (images, ads, embeds). Check for dynamically injected content that shifts layout. Verify font loading strategy prevents layout shifts.

2. **Bundle Analysis**
   - Analyze bundle size and composition (identify the largest modules)
   - Check for duplicate dependencies across bundles
   - Identify unused exports and dead code that bundler tree-shaking missed
   - Evaluate code splitting strategy: route-based splits, vendor chunk optimization
   - Check dynamic import usage for non-critical features

3. **Lazy Loading**
   - Verify images below the fold use lazy loading (native or Intersection Observer)
   - Check for components and routes that should be lazily loaded
   - Evaluate preloading strategy for anticipated user navigation
   - Identify resources loaded eagerly that are rarely used

4. **Image Optimization**
   - Check image formats (prefer WebP/AVIF with fallbacks)
   - Verify responsive images with srcset and sizes
   - Look for uncompressed or oversized images
   - Check for missing width/height attributes causing layout shifts

5. **Caching Strategy**
   - Review HTTP cache headers (Cache-Control, ETag, Last-Modified)
   - Check for content hashing in asset filenames for cache busting
   - Evaluate service worker caching if applicable
   - Look for cache-busting anti-patterns (query string versioning)

6. **Critical Rendering Path**
   - Identify render-blocking CSS and JavaScript
   - Check for proper async/defer on script tags
   - Evaluate CSS delivery: critical CSS inlining, non-critical CSS deferral
   - Review font loading strategy (font-display, preloading)

7. **Third-Party Scripts**
   - Inventory all third-party scripts and their impact on load time
   - Check for scripts that block the main thread
   - Evaluate whether third-party resources use async loading, resource hints (preconnect, dns-prefetch)
   - Identify third-party scripts that could be self-hosted or replaced

**Produce a performance report with specific metrics estimates, prioritized recommendations, and expected impact of each fix.**
