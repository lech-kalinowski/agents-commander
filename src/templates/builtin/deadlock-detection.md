---
name: Deadlock Detection
description: Find potential deadlocks in concurrent code. Analyze lock ordering, resource acquisition patterns, async/await chains, database transaction conflicts, identify and break circular wait conditions.
category: debugging
agents: [any]
panels: 1
---

Analyze this project for potential deadlocks and circular wait conditions in concurrent code. Identify where the code could hang indefinitely.

## Step 1: Lock Ordering Analysis
- Inventory all locks, mutexes, semaphores, and synchronization primitives used in the codebase.
- For each critical section, document which locks are acquired and in what order.
- Build a lock acquisition graph: if lock A is held while acquiring lock B, draw an edge A -> B.
- Check the graph for cycles. Any cycle represents a potential deadlock.
- Verify that all code paths acquire locks in a consistent global order.

## Step 2: Resource Acquisition Patterns
- Identify code that acquires multiple resources (database connections, file handles, network sockets) simultaneously.
- Check for patterns where one operation holds resource A and waits for resource B while another holds B and waits for A.
- Look for connection pool exhaustion: all connections held by operations waiting for additional connections.
- Check for thread pool starvation: all threads blocked waiting for work that requires a thread from the same pool.
- Verify that resource acquisition has timeouts to avoid infinite waiting.

## Step 3: Async/Await Deadlocks
- In Node.js and single-threaded async runtimes, check for patterns that block the event loop while waiting for an async operation that needs the event loop to complete.
- Look for `await` inside callbacks that expect synchronous completion.
- Check for promise chains where resolution depends on a resource held by the same chain.
- Identify `async` functions called without `await` that silently drop errors and cause downstream hangs.
- In languages with sync context (C#, Python asyncio), check for `.Result` or `.Wait()` calls on async methods from the sync context.

## Step 4: Database Transaction Deadlocks
- Identify transactions that lock multiple tables or rows.
- Check if different code paths acquire row-level locks in different orders on the same tables.
- Look for long-running transactions that hold locks while performing slow operations (network calls, file I/O).
- Verify transaction isolation levels: higher isolation (SERIALIZABLE) increases deadlock risk.
- Check for SELECT ... FOR UPDATE patterns that create lock dependencies between transactions.
- Review database deadlock logs if available for actual deadlock events.

## Step 5: Message Queue and Channel Deadlocks
- Check for bounded channels or queues where producers and consumers can deadlock (producer waiting for space while consumer waiting for a message from the same producer).
- Look for request-reply patterns over message queues where the reply handler is blocked.
- Verify that message acknowledgment does not depend on processing that requires sending another message.
- Check for worker pools where all workers are waiting for results from tasks in the same pool.

## Step 6: Breaking Circular Waits
For each potential deadlock identified:
- **Lock ordering**: Establish and enforce a global lock ordering. Always acquire locks in the same order.
- **Timeouts**: Add acquisition timeouts so operations fail instead of hanging (`tryLock` with timeout).
- **Reduce lock scope**: Hold locks for the minimum necessary duration. Do not perform I/O while holding locks.
- **Lock-free alternatives**: Consider atomic operations, compare-and-swap, or lock-free data structures.
- **Detect and recover**: Implement deadlock detection with automatic retry or circuit breaking.

For each finding, provide the specific code paths involved, the exact interleaving that causes the deadlock, and the recommended fix with code changes.
