---
name: Memory Leak Detection
description: Detect and fix memory leaks. Identify event listener leaks, closure-retained references, growing collections, unreleased resources, circular references. Suggest heap profiling approach.
category: debugging
agents: [any]
panels: 1
---

Analyze this project for memory leaks and excessive memory usage. Identify retained references, growing collections, and unreleased resources.

## Step 1: Event Listener Leaks
- Search for `addEventListener`, `on(`, `once(`, `subscribe(`, and `addListener(` calls.
- Verify each listener has a corresponding removal (removeEventListener, off, unsubscribe, removeListener).
- Check that listeners added in constructors or setup methods are removed in cleanup/destroy/unmount methods.
- Look for listeners added inside loops or frequently called functions without cleanup.
- In frontend frameworks, verify event listeners are cleaned up on component unmount or route change.

## Step 2: Closure-Retained References
- Identify closures that capture large objects (DOM elements, data arrays, class instances).
- Check for callbacks or promises that retain references to objects that should be garbage collected.
- Look for timers (setInterval, setTimeout) with closures that capture outer scope variables.
- Verify that callbacks passed to long-lived objects do not pin short-lived objects in memory.
- Check for accidental closures in module-level caches or registries.

## Step 3: Growing Collections
- Search for Maps, Sets, Arrays, and plain objects used as caches, registries, or stores.
- Verify each collection has a bounded growth strategy (max size, TTL, LRU eviction).
- Check for objects added to collections that are never removed (subscriber lists, connection pools, history buffers).
- Look for WeakMap/WeakSet usage opportunities where strong references are not needed.
- Inspect global or module-level variables that accumulate data across requests or operations.

## Step 4: Unreleased Resources
- Check that database connections, file handles, network sockets, and streams are properly closed.
- Verify try/finally or using/dispose patterns for resource cleanup.
- Look for connection pool exhaustion (connections acquired but not released on error paths).
- Check that child processes, workers, and spawned threads are terminated when no longer needed.
- Verify that temporary files, buffers, and large string concatenations are released promptly.

## Step 5: Circular References
- Identify object graphs with circular references that may prevent garbage collection in older runtimes.
- Check for parent-child relationships where both reference each other without weak references.
- Look for observer patterns where subjects and observers hold strong references to each other.
- Verify that circular references in data structures do not prevent JSON serialization or deep cloning.

## Step 6: Profiling Recommendations
- Suggest heap snapshot methodology: take snapshots before, during, and after the suspected leak scenario.
- Recommend comparing heap snapshots to identify objects that grow between snapshots.
- For Node.js: use `--inspect` with Chrome DevTools, `process.memoryUsage()`, or `v8.getHeapStatistics()`.
- For browsers: use Performance Monitor, Memory tab allocation timeline, and heap snapshot comparison.
- Suggest adding memory usage logging or metrics to track memory growth over time in production.

For each leak found, provide the file path, the leaking code, an explanation of why it leaks, and the specific fix.
