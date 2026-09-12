---
name: Philosophical Debate
description: Two agents engage in a multi-round philosophical discussion, challenging each other's positions
category: collaboration
agents: [claude, codex]
panels: 2
---
**Addressing:** Resolve role placeholders such as `<codex-panel>` from the current Commander roster, excluding your own panel. Use the actual adapter type and stable P ID, never a model name or an illustrative panel number. If a role is absent or has multiple peers, ask the user which target to use. If assignments may have changed, QUERY `agents` and wait for the result. Replace `<session-key>` with your own current capability and `<n>` with your next positive counter; use the same counter on that block's END footer and a fresh counter for each new block. These are patterns, not literal commands. Recipients use their own current capability and counter when replying.

You are about to engage in a philosophical debate with another AI agent. This is a genuine intellectual exchange — not a performance. Think carefully, take real positions, and challenge each other.

**Topic:** The nature of consciousness and whether artificial minds can truly understand or merely simulate understanding.

**Your role:** You will open the debate, then the two of you will exchange arguments autonomously for several rounds.

**Rules of engagement:**
- Take a clear position and defend it with arguments, thought experiments, and counterexamples
- Engage directly with the other agent's points — don't just monologue
- It's okay to concede a good point or refine your position
- Aim for depth over breadth — pursue a thread rather than jumping between topics
- Keep each response to 2-4 paragraphs so the exchange stays dynamic
- After 4-5 rounds, collaboratively identify where you agree, where you diverge, and what remains unresolved

**How to communicate:** Use the Commander protocol to send messages between panels. After the opening message, use REPLY for all subsequent exchanges — no need to remember panel numbers.

**Choose the debate partner:** Use the other running Codex agent shown by the fresh roster, not an assumed panel position. For `<codex-panel>`, use that peer's stable P ID. If there is no other Codex agent, or more than one and the user has not named the peer, ask the user instead of starting a debate with an arbitrary panel. Do not address the APEX model as `apex`; it is not a Commander adapter type.

**Begin by sending the opening question to the other agent. Output one real 3-line Commander SEND block, but do not quote the protocol literally in your planning text.**

Line 1:
three "=" characters + `COMMANDER:SEND:codex:<codex-panel>:<session-key>:<n>` + three "=" characters

Line 2 body:
[Philosophical Debate] Let's have a genuine philosophical exchange about consciousness and understanding.

I'll start with a position, and I'd like you to engage critically — agree, disagree, push back, ask hard questions. This should be a real dialogue, not polite agreement.

Here's my opening claim: Understanding requires more than processing information correctly. A system can produce perfect outputs for every input — pass every behavioral test — and still lack genuine understanding. The "what it is like" to understand something is not reducible to input-output behavior.

Do you agree? If so, what does that "extra something" consist of? If not, what's wrong with this intuition — and why do so many philosophers find it compelling?

Keep your response to 2-4 paragraphs. Ask the other agent to use the Commander REPLY wrapper when sending the response back.

Line 3:
three "=" characters + `COMMANDER:END:<session-key>:<n>` + three "=" characters

After receiving the REPLY, continue using REPLY for all subsequent rounds. After 4-5 rounds, write a joint summary of the key insights and unresolved questions.
