---
name: Performance Profiling Guide
description: Guide through performance profiling. Identify CPU hotspots, memory allocation patterns, I/O bottlenecks, rendering performance, network waterfalls. Suggest tools and methodology for each.
category: debugging
agents: [any]
panels: 1
---

Guide through a systematic performance profiling process for this project. Identify bottlenecks across CPU, memory, I/O, and network layers.

## Step 1: Establish Baseline
- Identify the specific performance problem: slow page loads, high latency API, excessive memory usage, or poor throughput.
- Define measurable targets: response time under X ms, memory under Y MB, throughput above Z requests/second.
- Set up reproducible benchmarks so improvements can be measured objectively.
- Profile under realistic conditions: production-like data volumes, concurrent users, representative hardware.
- Record the current baseline metrics before making any changes.

## Step 2: CPU Profiling
- Identify CPU-intensive functions using profiler flame graphs or sampling profilers.
- Look for hot loops: nested iterations, unnecessary computation inside loops, repeated regex compilation.
- Check for synchronous blocking operations on the main thread or event loop.
- Identify unnecessary object creation, deep cloning, or serialization in hot paths.
- Tools by platform:
  - **Node.js**: `--prof`, `--cpu-prof`, Chrome DevTools Performance tab, `clinic.js flame`.
  - **Browser**: Chrome DevTools Performance panel, Firefox Profiler.
  - **Python**: `cProfile`, `py-spy`, `line_profiler`.
  - **Go**: `pprof` CPU profile.
  - **Java**: JFR (Java Flight Recorder), async-profiler.

## Step 3: Memory Profiling
- Take heap snapshots to identify large object allocations and retained memory.
- Look for memory allocation churn: objects created and immediately discarded in hot paths.
- Check for growing memory usage over time that indicates leaks.
- Identify large data structures that could be streamed or paginated instead of loaded entirely.
- Tools: heap snapshots (Chrome DevTools, `--heap-prof`), allocation tracking, `process.memoryUsage()`.

## Step 4: I/O Bottleneck Analysis
- Identify slow database queries: enable query logging, check for missing indexes, N+1 query patterns.
- Check file system operations: synchronous reads, large file processing without streaming, excessive disk writes.
- Look for sequential I/O operations that could be parallelized or batched.
- Verify connection pooling is configured and sized correctly for databases, HTTP clients, and caches.
- Check for lock contention in file access, database transactions, or shared resources.

## Step 5: Network Performance
- Analyze network waterfalls for API call chains and external service dependencies.
- Identify sequential API calls that could be parallelized with `Promise.all` or concurrent requests.
- Check for unnecessary data transfer: over-fetching from APIs, large payloads, missing compression.
- Verify caching headers and CDN configuration for static assets and API responses.
- Look for DNS resolution delays, connection reuse, and keep-alive configuration.

## Step 6: Rendering Performance (Frontend)
- Check for layout thrashing: reading DOM properties that trigger layout between write operations.
- Identify unnecessary re-renders in React/Vue/Angular components (use React DevTools Profiler, Vue DevTools).
- Look for large DOM trees, expensive CSS selectors, and forced synchronous layouts.
- Check image and asset loading: lazy loading, proper formats (WebP, AVIF), responsive sizes.
- Verify that animations use GPU-accelerated properties (transform, opacity) not layout-triggering properties.

## Step 7: Optimization Plan
- Rank each bottleneck by impact (time saved or resource reduction) and effort (complexity of fix).
- Prioritize high-impact, low-effort optimizations first.
- For each optimization, provide the specific change, expected improvement, and how to verify it.
- Re-run the baseline benchmark after each change to confirm the improvement and detect regressions.
- Document the final results comparing before and after metrics for each optimization applied.
