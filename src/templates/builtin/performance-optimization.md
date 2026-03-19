---
name: Performance Optimization
description: Identify and fix performance bottlenecks in the codebase
category: single-agent
agents: [any]
panels: 1
---
Analyze this project for performance issues and optimization opportunities.

**1. Identify Bottlenecks**
- CPU-intensive operations (unnecessary loops, heavy computation)
- Memory issues (leaks, excessive allocations, large data structures)
- I/O bottlenecks (synchronous operations, missing caching, N+1 queries)
- Network inefficiencies (excessive API calls, missing batching)

**2. For Each Issue Found, Provide:**
- File path and line numbers
- Description of the problem
- Estimated impact (high/medium/low)
- Specific fix with code example

**3. Quick Wins**
- Easy optimizations with high impact
- Caching opportunities
- Lazy loading candidates
- Unnecessary work that can be eliminated

**4. Architectural Optimizations**
- Data structure improvements
- Algorithm complexity reductions
- Concurrency/parallelism opportunities
- Resource pooling suggestions

**5. Monitoring Recommendations**
- Key metrics to track
- Suggested profiling approach
- Performance testing strategy

Focus on actionable improvements with the highest impact-to-effort ratio.
