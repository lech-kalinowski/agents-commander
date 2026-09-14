# Commander Protocol for AI Research

## A lightweight coordination layer for terminal-native multi-agent systems

Baseline: source `0.1.5` at commit `001e903`, reviewed 2026-09-02.
This is a source implementation description, not a claim about the published
npm package. The current source now adds [opt-in capture and reviewed dataset
export](datasets.md); broader research extensions below remain proposals.
The sequence and replay-protection notes were updated on 2026-09-11 for
version 0.1.6, which includes the extension absent from 0.1.5. This version scope
describes implementation contents, not verified npm publication.
The explicitly labelled unreleased notes below describe the new OpenCode
completion-hook transport and failure feedback after 0.1.10. Its full live
acceptance is a separate gate; 0.1.10's short-exchange tests did not validate long
messages or multi-agent broadcast workflows. See [QA scope](qa.md).

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

The Commander Protocol exposes five primary commands. The examples below use
version 0.1.6's recommended sequence suffix: `<N>` is one increasing
counter shared by all five verbs from one armed session, starting at `1` for a
fresh capability. Both markers use the same number. Original redraws retain
their number; an intentional new action, including identical text, gets the
next number. Capability-only markers remain compatible as described in §5.4.

### 3.1 SEND

`SEND` is used for directed communication to a specific agent and panel.

Example:

```text
===COMMANDER:SEND:codex:2:<session-key>:<N>===
Please review the API design and propose a simpler interface.
===COMMANDER:END:<session-key>:<N>===
```

Semantically, `SEND` creates a thread and queues a message for the addressed running session. Commander records the delivery outcome and attempts to return a structured acknowledgement to the still-active sender. A successful delivery opens a reply window; rejected or failed delivery does not establish that the target acted on the task.

### 3.2 REPLY

`REPLY` continues the latest open thread for the current session.

```text
===COMMANDER:REPLY:<session-key>:<N>===
I agree with the refactor direction, but the caching layer still leaks concerns.
===COMMANDER:END:<session-key>:<N>===
```

In source `0.1.5`, `REPLY` claims the newest open reply window for the current session and resolves its return session, thread and prior message. Claiming consumes that window; failed delivery restores it only if both sessions remain active. With no open window, the reply is dropped. The route is explicit runtime state, not a model-selected thread ID or a reconstruction from the last visible sender.

Unreleased source retains that routing rule but returns a failed ACK when no
window or return session exists. It never guesses another recipient.

### 3.3 BROADCAST

`BROADCAST` queues one message for each other connected running agent. Targets are checked independently; it does not launch missing agents or send to file panels.

```text
===COMMANDER:BROADCAST:<session-key>:<N>===
Standup: I am starting test hardening. Report blockers in one short reply.
===COMMANDER:END:<session-key>:<N>===
```

Broadcast is useful for coordination experiments, synchronization prompts, and shared-state announcements.

### 3.4 STATUS

`STATUS` reports progress to Commander rather than to another agent.

```text
===COMMANDER:STATUS:<session-key>:<N>===
Profiling complete. I am now investigating the slow query path.
===COMMANDER:END:<session-key>:<N>===
```

Commander displays the status in the UI and returns a local acknowledgement so the sender knows the update was accepted.

### 3.5 QUERY

`QUERY` asks Commander for environment information such as active agents, panel layout, or protocol help.

```text
===COMMANDER:QUERY:<session-key>:<N>===
agents
===COMMANDER:END:<session-key>:<N>===
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

The optional wire `sequence` is different from this controller-generated
`messageId`. A sequence identifies an agent-authored command before routing,
including STATUS and QUERY; it is not a target address, thread selector, or
completion acknowledgement. It must be a canonical positive decimal integer
no greater than `9007199254740991`. Header and footer capability and sequence
must match; a missing or different footer sequence cannot complete that frame.

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

`delivered` means input submitted to the target PTY, not model acceptance or
task completion. Failed SEND/REPLY delivery uses `status=failed` and an error.
BROADCAST produces one combined queue-admission ACK; STATUS uses
`kind=status status=accepted`. QUERY returns controller information. Unarmed,
replayed or startup-suppressed frames may have no ACK. These are distinct
observation points, not interchangeable quality labels.

Unreleased source additionally reports a later failed broadcast recipient with
`kind=broadcast status=failed scope=recipient stage=delivery`, identifying its
message, thread and panel. This is not an aggregate completion report. Empty
broadcasts and orphan REPLYs return failed ACKs; queued recipient cancellation
notifies a still-valid source once, never a replacement or a shutdown session.

## 5. Execution Model in Source

The source implementation combines several mechanisms intended to improve reliability beyond an untracked text relay.

### 5.1 Per-panel task queues

All tasks targeting the same panel are serialized through a queue. This prevents overlapping writes to the same terminal session and keeps inter-agent communication ordered.

### 5.2 Delivery-aware engagement

When Commander successfully delivers a user-selected collaboration task or routed message to an agent, that session is marked as engaged. This prevents genuine agent actions from being mistaken for irrelevant startup chatter.

### 5.3 Terminal-native transport

The 0.1.5–0.1.10 transport detects output through terminal I/O. Unreleased
OpenCode source instead loads a bundled plugin for that launch and receives
completed assistant text parts through private inherited fd4 IPC. Existing
inline JSON settings are preserved; user configuration files are not edited.
An authenticated arm plus exact injected instructions binds one OpenCode
conversation. Native transport failure never enables a rendered-output fallback.
Other adapters continue terminal scanning, and all recipient delivery uses PTY
input. Protocol output and controller feedback can be visible in panels, but
the screen, diagnostic log and bounded Activity history are not a complete
transcript. Provider history, reasoning, tools and raw keyboard input are not
reconstructed or recorded by the plugin; capture still requires launch consent.

OpenCode framing is validated within each completed text part, not assembled
across parts/messages/tools. Default body limits are 500 lines and 256 KiB; the
native complete-part cap is 1 MiB. Incomplete/invalid authored frames are not
partially routed; recognized rejected counters remain spent. Ordinary protocol
whitespace/control normalization still applies, so transport fidelity is not a
claim of arbitrary binary or exact surrounding-whitespace preservation.

### 5.4 Deduplication and echo control

Terminal UIs can repaint historical output long after it was first visible.
Version 0.1.6 replay protection retains identities across visible-grid and
scrollback scans, elapsed time, fullscreen changes and PTY resize. Sequenced
frames are identified by capability and number, not by the rendered body: a
changed verb, target, body or hard line wrapping cannot reuse the same sequence.
Recognized outgoing instruction and prompt examples are premarked so repeated
echoes cannot later become authored protocol actions.

Each capability uses a bounded 4,096-number sliding replay window. A previously
unseen number may arrive out of order within the window; duplicates and numbers
below its advancing floor are rejected. Legacy unsequenced frames instead use
conservative, non-evicting command fingerprints: an identical frame can be
accepted only once until process or explicitly armed capability replacement.
This cannot reliably infer
identity when a CLI changes hard line breaks in legacy text, nor distinguish
an intentional identical legacy command from a redraw. New workflows should
use sequences rather than attempting to recover meaning from whitespace.

Storage is limited to 4,096 legacy fingerprints and eight sequence-capability
scopes. Exhaustion fails closed and is indicated in the panel header. Starting
a new agent process or explicitly arming a fresh capability resets the guard;
old-capability output is then rejected before replay processing. `Ctrl+P`
rotates the key; F2 → P skips already-armed sessions. Reinject only into an empty,
ready prompt and inspect prior deliveries before retrying uncertain work.
No replay state is reset by resize or fullscreen. These are process-local
protections, not durable exactly-once delivery, model-task
completion guarantees, or an automatic retry protocol. A suppressed frame may
receive no ACK; investigate the actual delivery before intentionally retrying
with a new number.

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

### 7.1 Transport-specific limitations remain

Terminal-scanned adapters remain vulnerable to output rendering and prompt-echo
quirks. The unreleased OpenCode path avoids viewport virtualization but depends
on the OpenCode 1.18.30 completion-hook contract and a working inherited channel;
future CLI versions require validation. All adapters still depend on PTY input
submission and model compliance. A delivery ACK is not evidence that the model
read, understood or completed the requested task.

### 7.2 Human-readable syntax still requires containment

Literal protocol markers can appear inside examples, templates, or help text. Session-bound capabilities now make static or stale markers inert, and explicit template delivery binds trusted collaboration templates to the current session. Prompt-injection risk still exists after a human deliberately arms an agent, so routed output is also prohibited from replacing or killing an occupied target.

### 7.3 It is a coordination layer, not a semantic planner

Commander does not decide what the agents should believe, prioritize, or conclude. It only structures how messages are routed and tracked. Higher-level planning still depends on prompt design and model behavior.

### 7.4 Persistence is still limited

The current ledger is in-memory and stores SEND/REPLY/BROADCAST only. Defaults are 1,000 records, 8 MiB total retained content and 256 KiB per record; F12 displays the latest 100 summaries. STATUS/QUERY and control responses are not part of that history. Ctrl+L exposes a rotating diagnostic log, not a conversation archive. A separate [opt-in semantic recorder and reviewed dataset exporter](datasets.md) is now available in source. Full transcripts, replay and model training are not implemented. The [session capture and training-data plan](session-capture-plan.md) retains the broader design.

## 8. Research Directions

Several natural research extensions follow from the current design.

### 8.1 Durable message logs

Opt-in messages and delivery events can support offline analysis and benchmark creation. The [capture plan](session-capture-plan.md) separates recording from reviewed dataset export; automatic execution or replay of captured text is not implemented. Schema validation is not evidence of semantic quality or model-level improvement.

### 8.2 Alternative transports

Unreleased OpenCode source begins separating authored output from the display
with a private local completion channel. A shared durable bus, database queue,
multi-client transport or history replay remains future work. Such experiments
must preserve the existing session, consent and replay boundaries.

### 8.3 Automated evaluation

Because the protocol creates explicit coordination events, it is suitable for metrics-driven evaluation of collaboration quality, not just output quality.

### 8.4 Cross-agent comparison

The same task can be run with different combinations of terminal-native agents, making Commander a practical harness for comparative studies in delegation style and conversational stability.

## Conclusion

The Commander Protocol combines human-readable commands with runtime state such as sessions, message identities, threads, acknowledgements, and delivery queues. Source `0.1.5` provides an inspectable coordination mechanism and opt-in data preparation; reproducible longitudinal studies still require permissioned collection, independent review and held-out evaluation.

For AI research, its value is not that it solves all coordination problems. Its value is that it exposes them clearly enough to study. That makes it useful both as an engineering mechanism and as a research instrument for understanding how agents coordinate, fail, recover, and collaborate in real tool-using environments.
