# Commander Protocol for AI Research

## A lightweight coordination layer for terminal-native multi-agent systems

Scope: current source `0.1.5` at commit `001e903`, reviewed 2026-09-02.
This is a source implementation description, not a claim about the published
npm package. Research extensions below are proposals, not shipped features.

### Abstract

The Commander Protocol is a human-readable coordination protocol for AI agents that operate inside terminal sessions. It was designed for a practical problem: enabling multiple command-line agents to communicate, delegate work, report progress, and maintain conversational threads without requiring a heavyweight orchestration backend. The protocol uses explicit message markers, structured acknowledgements, per-session identity, and thread tracking to support multi-agent collaboration in a terminal user interface. This document describes the source implementation identified above and its potential use as a research artifact for studying agent coordination, interaction design, and reliability in mixed human-agent workflows.

## 1. Motivation

Many AI agents today live inside terminal-centric environments: coding assistants, research assistants, shell-based language models, and tool-using command-line agents. These systems are powerful in isolation, but collaboration between them is usually improvised. Researchers often rely on copied prompts, manual relaying of outputs, or hidden side channels that are difficult to inspect and reproduce.

The Commander Protocol addresses this gap by offering a minimal, inspectable coordination layer that works directly in a shared terminal workspace. Its goals are:

- make inter-agent communication explicit and observable
- preserve human control while allowing agents to coordinate autonomously
- support delegation, reply chains, status reporting, and environment queries
- remain simple enough to debug from terminal logs and screen recordings

In other words, the protocol is intentionally small, but it is designed to expose the core mechanics of multi-agent collaboration in a way that is experimentally useful.

## 2. System Model

The protocol assumes a Commander process manages multiple terminal panels. Each panel hosts one agent session, such as Claude Code, Codex CLI, or Gemini CLI. The Commander process sits between panels and performs five responsibilities:

1. detect protocol messages produced by agents
2. route those messages to the correct target session
3. serialize delivery so panel input does not interleave
4. acknowledge delivery outcomes
5. maintain thread state so `REPLY` has a concrete target

In source `0.1.5`, the protocol is not only marker-based. It is backed by orchestration state that includes:

- stable `sessionId` values for running agent sessions
- process-local `messageId` values for individual routed messages
- `threadId` values for reply chains
- a message ledger that records creation, delivery, failure, and open reply windows

This matters for research because it shifts the protocol from a text trick to a measurable coordination system.

## 3. Core Message Types

The Commander Protocol exposes five primary commands.

### 3.1 SEND

`SEND` is used for directed communication to a specific agent and panel.

Example:

```text
===COMMANDER:SEND:codex:2:<session-key>===
Please review the API design and propose a simpler interface.
===COMMANDER:END:<session-key>===
```

Semantically, `SEND` creates a thread and queues a message for the addressed running session. Commander records the delivery outcome and attempts to return a structured acknowledgement to the still-active sender. A successful delivery opens a reply window; rejected or failed delivery does not establish that the target acted on the task.

### 3.2 REPLY

`REPLY` continues the latest open thread for the current session.

```text
===COMMANDER:REPLY:<session-key>===
I agree with the refactor direction, but the caching layer still leaks concerns.
===COMMANDER:END:<session-key>===
```

In source `0.1.5`, `REPLY` claims the newest open reply window for the current session and resolves its return session, thread and prior message. Claiming consumes that window; failed delivery restores it only if both sessions remain active. With no open window, the reply is dropped. The route is explicit runtime state, not a model-selected thread ID or a reconstruction from the last visible sender.

### 3.3 BROADCAST

`BROADCAST` queues one message for each other connected running agent. Targets are checked independently; it does not launch missing agents or send to file panels.

```text
===COMMANDER:BROADCAST:<session-key>===
Standup: I am starting test hardening. Report blockers in one short reply.
===COMMANDER:END:<session-key>===
```

Broadcast is useful for coordination experiments, synchronization prompts, and shared-state announcements.

### 3.4 STATUS

`STATUS` reports progress to Commander rather than to another agent.

```text
===COMMANDER:STATUS:<session-key>===
Profiling complete. I am now investigating the slow query path.
===COMMANDER:END:<session-key>===
```

Commander displays the status in the UI and returns a local acknowledgement so the sender knows the update was accepted.

### 3.5 QUERY

`QUERY` asks Commander for environment information such as active agents, panel layout, or protocol help.

```text
===COMMANDER:QUERY:<session-key>===
agents
===COMMANDER:END:<session-key>===
```

This gives agents a controlled way to inspect coordination state without inventing their own discovery logic.

## 4. Protocol Envelope and State

The visible protocol syntax is intentionally simple, but the runtime model is richer. `Ctrl+P` arms one managed session with a fresh capability; `<session-key>` above represents that injected value. Headers and footers without the current session capability are parsed for display compatibility but never routed.

### 4.1 Session Identity

Each running agent is associated with a stable `sessionId` for the life of that process. This avoids routing errors when panels are reordered or replaced. The panel index remains a UI concern; session identity is the routing concern.

### 4.2 Message Identity

Each routed message gets a `messageId`. This allows Commander to:

- distinguish one delivery from another
- track acknowledgements
- open reply windows against a concrete prior message
- support logging and future persistence

### 4.3 Thread Identity

Each directed exchange belongs to a `threadId`. This lets researchers study not just single message delivery, but structured conversational chains across multiple agents.

### 4.4 Structured ACKs

After successful delivery, Commander emits a structured acknowledgement in the sender's panel. A typical acknowledgement includes:

- delivery status
- message id
- thread id
- target name
- target panel

For example:

```text
[Commander ACK] status=delivered msg=msg_000001 thread=thr_000001 target="Codex CLI" panel=2
```

`delivered` means input submitted to the target PTY, not model acceptance or task completion. Failed SEND/REPLY delivery uses `status=failed` and an error. BROADCAST produces one combined queue-admission ACK, not per-target delivery ACKs; STATUS uses `kind=status status=accepted`. QUERY returns controller information. Unarmed, suppressed or orphaned frames may have no ACK. These are distinct observation points, not interchangeable quality labels.

## 5. Execution Model in Source `0.1.5`

The source implementation combines several mechanisms intended to improve reliability beyond an untracked text relay.

### 5.1 Per-panel task queues

All tasks targeting the same panel are serialized through a queue. This prevents overlapping writes to the same terminal session and keeps inter-agent communication ordered.

### 5.2 Delivery-aware engagement

When Commander successfully delivers a user-selected collaboration task or routed message to an agent, that session is marked as engaged. This prevents genuine agent actions from being mistaken for irrelevant startup chatter.

### 5.3 Terminal-native transport

The transport layer operates through terminal I/O rather than a hidden service bus. Protocol output and controller feedback are visible in panels, but the screen, diagnostic log and bounded Activity history are not a complete transcript. Private provider prompts, reasoning, tool calls and directly typed context are not reconstructed by Commander.

### 5.4 Deduplication and echo control

Because terminal UIs can re-render visible content, Commander performs deduplication across scrollback scanning and grid scanning. It also suppresses instruction echoes and prompt replays that would otherwise be mistaken for real protocol actions.

### 5.5 UTF-8 safe decoding

Source `0.1.5` uses stream-safe UTF-8 decoding for PTY output. This matters for modern agent CLIs because progress indicators, spinner glyphs, and non-ASCII symbols often arrive in fragmented chunks.

## 6. Why the Protocol Matters for AI Research

The Commander Protocol is interesting as a research object for several reasons.

### 6.1 It enables reproducible coordination studies

Researchers can specify explicit communication acts and compare how different agents use them. Instead of asking whether agents "collaborate well" in the abstract, one can measure:

- delegation frequency
- reply latency
- thread depth
- acknowledgement compliance
- broadcast responsiveness

### 6.2 It separates interaction design from model capability

A model may be strong at reasoning but weak at collaboration because the communication interface is ambiguous. Commander makes coordination explicit enough to study the effect of protocol design on collaborative performance.

### 6.3 It supports mixed-initiative workflows

The protocol is neither fully autonomous nor fully manual. Humans can inject tasks, observe coordination, intervene, and restart threads. This makes it a good environment for studying mixed-initiative research systems.

### 6.4 It is inspectable

Unlike opaque agent pipelines, the Commander Protocol is legible. Researchers can inspect prompts, protocol blocks, acknowledgements, routing decisions, and visible panel state. This is valuable for debugging and for writing methodological sections in papers.

## 7. Limitations

The protocol also has clear limitations, which are themselves useful from a research perspective.

### 7.1 It is still transport-coupled to terminal behavior

The protocol operates through terminal rendering, PTY input, and screen scanning. This makes it realistic for command-line agents, but also vulnerable to prompt echo, UI formatting quirks, and timing issues.

### 7.2 Human-readable syntax still requires containment

Literal protocol markers can appear inside examples, templates, or help text. Session-bound capabilities now make static or stale markers inert, and explicit template delivery binds trusted collaboration templates to the current session. Prompt-injection risk still exists after a human deliberately arms an agent, so routed output is also prohibited from replacing or killing an occupied target.

### 7.3 It is a coordination layer, not a semantic planner

Commander does not decide what the agents should believe, prioritize, or conclude. It only structures how messages are routed and tracked. Higher-level planning still depends on prompt design and model behavior.

### 7.4 Persistence is still limited

The current ledger is in-memory and stores SEND/REPLY/BROADCAST only. Defaults are 1,000 records, 8 MiB total retained content and 256 KiB per record; F12 displays the latest 100 summaries. STATUS/QUERY and control responses are not part of that history. Ctrl+L exposes a rotating diagnostic log, not a conversation archive. Durable session capture, dataset export and replay are not implemented. The [session capture and training-data plan](session-capture-plan.md) proposes opt-in semantic recording, privacy review and offline export.

## 8. Research Directions

Several natural research extensions follow from the current design.

### 8.1 Durable message logs

Persisting messages and delivery events could support offline analysis and benchmark creation. The [proposed capture plan](session-capture-plan.md) separates recording from reviewed dataset export; automatic execution or replay of captured text is not part of that plan.

### 8.2 Alternative transports

A future version could keep the Commander protocol semantics while moving transport to a local bus, JSONL event stream, or lightweight database queue. This would help isolate transport effects from protocol effects.

### 8.3 Automated evaluation

Because the protocol creates explicit coordination events, it is suitable for metrics-driven evaluation of collaboration quality, not just output quality.

### 8.4 Cross-agent comparison

The same task can be run with different combinations of terminal-native agents, making Commander a practical harness for comparative studies in delegation style and conversational stability.

## Conclusion

The Commander Protocol combines human-readable commands with runtime state such as sessions, message identities, threads, acknowledgements, and delivery queues. Source `0.1.5` provides an inspectable coordination mechanism; reproducible longitudinal studies still require the proposed capture and evaluation work.

For AI research, its value is not that it solves all coordination problems. Its value is that it exposes them clearly enough to study. That makes it useful both as an engineering mechanism and as a research instrument for understanding how agents coordinate, fail, recover, and collaborate in real tool-using environments.
