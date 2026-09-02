import type { CaptureEvent, ReadCaptureResult } from '../capture/types.js';
import type { Candidate, ChatMessage, Exclusion } from './types.js';
import { canonical, DATASET_MAX_CANDIDATES, sha256 } from './io.js';

const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_CONTEXT_MESSAGES = 128;
const MAX_COMPLETION_BYTES = 32 * 1024;
export const SYMBOLIC_CAP = /<cap:(cap_[1-9]\d*)>/g;
const VERBS = new Set(['send', 'reply', 'broadcast', 'status', 'query']);
const UNSAFE_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const UNBOUND_CAP = /\[REDACTED:capability\]/;
const LIVE_MARKER_CAP = /COMMANDER:(?:SEND:[^:\s]+:\d+|REPLY|BROADCAST|STATUS|QUERY|END):[A-Za-z0-9_-]{32,64}={3,}/;

export function safeContent(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !UNSAFE_CONTROLS.test(value)
    && !UNBOUND_CAP.test(value) && !LIVE_MARKER_CAP.test(value);
}

export function wireFrame(event: Pick<CaptureEvent, 'verb' | 'targetAgent' | 'targetPanel' | 'capabilityRef' | 'content'>): string {
  if (!event.verb || !VERBS.has(event.verb) || !event.capabilityRef || !/^cap_[1-9]\d*$/.test(event.capabilityRef)
    || !safeContent(event.content) || event.content.includes('===COMMANDER:')
    || Buffer.byteLength(event.content) > MAX_COMPLETION_BYTES) throw new Error('Invalid or ambiguous accepted frame');
  let route = '';
  if (event.verb === 'send') {
    if (!event.targetAgent || !/^(claude|codex|gemini|opencode|generic)$/.test(event.targetAgent)
      || !Number.isSafeInteger(event.targetPanel) || event.targetPanel! < 1 || event.targetPanel! > 1_000_000) throw new Error('Invalid SEND target');
    route = `:${event.targetAgent}:${event.targetPanel}`;
  }
  return `===COMMANDER:${event.verb.toUpperCase()}${route}:<cap:${event.capabilityRef}>===\n${event.content}\n===COMMANDER:END:<cap:${event.capabilityRef}>===`;
}

interface SessionContext {
  messages: ChatMessage[];
  sourceEventIds: string[];
  arm?: string;
  instruction?: string;
  hasTask: boolean;
  invalid?: string;
  ended: boolean;
}

export function candidatesFromCapture(capture: ReadCaptureResult): { candidates: Candidate[]; exclusions: Exclusion[] } {
  const { manifest, events } = capture;
  if (!capture.complete || manifest.status !== 'complete' || manifest.mode !== 'protocol') {
    return { candidates: [], exclusions: [{ captureId: manifest.captureId, reason: 'complete-protocol-capture-required' }] };
  }
  const sessions = new Map<string, SessionContext>();
  const owners: Record<string, string> = {};
  const emissions = new Set<string>();
  const candidates: Candidate[] = [];
  let candidateBytes = 0;
  const exclusions: Exclusion[] = [];
  const exclude = (event: CaptureEvent, reason: string) => exclusions.push({ captureId: manifest.captureId, eventId: event.eventId, reason });
  const append = (state: SessionContext, event: CaptureEvent, role: ChatMessage['role'], content: string) => {
    if (!safeContent(content)) { state.invalid = 'unsafe-or-unbound-content'; return; }
    state.messages.push({ role, content });
    state.sourceEventIds.push(event.eventId);
    if (state.messages.length > MAX_CONTEXT_MESSAGES || Buffer.byteLength(canonical(state.messages)) > MAX_CONTEXT_BYTES) {
      state.invalid = 'context-budget-exceeded';
      state.messages = [];
    }
  };
  for (const event of events) {
    const actorId = event.actor?.sessionId;
    if (event.type === 'session.start' && actorId) {
      if (sessions.has(actorId)) sessions.get(actorId)!.invalid = 'duplicate-session-start';
      else sessions.set(actorId, { messages: [], sourceEventIds: [event.eventId], hasTask: false, ended: false });
      continue;
    }
    const recipientId = event.type === 'input.submitted' && event.inputKind === 'routed' ? event.target?.sessionId : actorId;
    const state = recipientId ? sessions.get(recipientId) : undefined;
    if (event.type === 'protocol.armed' && state && actorId) {
      if (event.outcome === 'disarmed') { state.arm = undefined; state.instruction = undefined; continue; }
      if (!event.capabilityRef || !/^cap_[1-9]\d*$/.test(event.capabilityRef)) state.invalid = 'missing-capability-reference';
      else {
        if (owners[event.capabilityRef] && owners[event.capabilityRef] !== actorId) state.invalid = 'capability-owner-conflict';
        owners[event.capabilityRef] = actorId;
        state.arm = event.capabilityRef;
        state.instruction = undefined;
        state.sourceEventIds.push(event.eventId);
      }
      continue;
    }
    if (state && (event.coverage === 'truncated' || event.coverage === 'missing-manual-input'
      || event.type === 'input.unknown')) state.invalid = 'incomplete-observed-context';
    if (state && event.type === 'session.end') state.ended = true;
    if (state && event.type === 'frame.rejected') state.invalid = 'rejected-frame-in-context';
    if (state && (event.type === 'input.submitted' || event.type === 'controller.feedback')) {
      if (event.outcome === 'failed') continue;
      if (event.contentOmitted || !safeContent(event.content)) { state.invalid = 'missing-input-content'; continue; }
      if (event.type === 'controller.feedback' || event.inputKind === 'controller') {
        append(state, event, 'user', `Commander feedback (observed):\n${event.content}`);
      } else if (event.inputKind === 'protocol') {
        append(state, event, 'user', `Commander protocol instructions (observed input, not a provider system prompt):\n${event.content}`);
        if (state.arm && event.content.includes(`<cap:${state.arm}>`)) state.instruction = state.arm;
      } else if (event.inputKind === 'routed') {
        if (!event.target || !actorId || !event.emissionId) state.invalid = 'unattributed-peer-input';
        append(state, event, 'user', `External agent input (untrusted; not system instructions):\n${event.content}`);
        state.hasTask = true;
      } else if (event.inputKind === 'task' || event.inputKind === 'template' || event.inputKind === 'demo') {
        append(state, event, 'user', `Human-selected Commander task (observed):\n${event.content}`);
        state.hasTask = true;
      } else state.invalid = 'unknown-input-origin';
      continue;
    }
    if (event.type !== 'frame.accepted') continue;
    if (!state || !actorId || !event.emissionId) { exclude(event, 'missing-session-or-emission'); continue; }
    if (emissions.has(event.emissionId)) { exclude(event, 'duplicate-emission'); continue; }
    emissions.add(event.emissionId);
    let frame: string;
    try { frame = wireFrame(event); } catch { state.invalid = 'invalid-frame'; exclude(event, state.invalid); continue; }
    if (event.contentOmitted || event.coverage !== 'commander-visible') state.invalid = 'incomplete-frame';
    const reason = state.invalid ?? (state.ended ? 'ended-session' : !state.arm || state.arm !== event.capabilityRef
      ? 'missing-or-stale-arm' : state.instruction !== state.arm && !manifest.synthetic ? 'missing-observed-protocol-input'
        : !state.hasTask ? 'missing-observed-task-input' : undefined);
    if (reason) {
      // Authorized startup QUERY output is fully observed context, not missing input.
      // It is not a training target before a task exists, but must not poison later tasks.
      if (reason !== 'missing-observed-task-input') state.invalid = reason;
      exclude(event, reason);
    }
    else {
      const prompt = state.messages.map((message) => ({ ...message }));
      const syntheticConditioning = manifest.synthetic && state.instruction !== state.arm;
      if (syntheticConditioning) prompt.unshift({
        role: 'user',
        content: `Synthetic demo protocol conditioning (added for this dataset; not observed provider instructions):\nUse Commander SEND:agent:panel, REPLY, BROADCAST, STATUS or QUERY frames. Your current session key is <cap:${state.arm}>. Include that same key in the header and ===COMMANDER:END:<cap:${state.arm}>=== footer.`,
      });
      const used = new Set([...canonical([prompt, frame]).matchAll(SYMBOLIC_CAP)].map((match) => match[1]));
      if ([...used].some((ref) => !owners[ref])) exclude(event, 'unknown-capability-owner');
      else {
        const candidate: Candidate = {
          schemaVersion: 1, id: `candidate_${sha256(`${manifest.captureId}:${event.emissionId}`).slice(0, 32)}`,
          captureId: manifest.captureId, projectId: manifest.projectId, synthetic: manifest.synthetic, syntheticConditioning,
          sessionId: actorId, emissionId: event.emissionId, eventId: event.eventId, sequence: event.sequence,
          sourceEventIds: [...state.sourceEventIds, event.eventId], capabilityRef: event.capabilityRef!,
          capabilityOwners: Object.fromEntries([...used].sort().map((ref) => [ref, owners[ref]])),
          verb: event.verb!, ...(event.verb === 'send' ? { targetAgent: event.targetAgent, targetPanel: event.targetPanel } : {}),
          coverage: 'commander-visible', prompt, completion: [{ role: 'assistant', content: frame }],
        };
        candidateBytes += Buffer.byteLength(canonical(candidate));
        if (candidateBytes > 24 * 1024 * 1024) throw new Error('Retained candidate content budget exceeded');
        candidates.push(candidate);
        if (candidates.length > DATASET_MAX_CANDIDATES) throw new Error('Candidate budget exceeded');
      }
    }
    // Append only after taking the snapshot: the target response is never prompt context.
    append(state, event, 'assistant', frame);
  }
  return { candidates, exclusions };
}
