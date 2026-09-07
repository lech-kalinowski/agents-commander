import type { CaptureEvent, CaptureInput, CaptureLimits } from './types.js';
import { isPanelNumber } from '../panel-limits.js';

export const CAPTURE_LIMITS: Readonly<CaptureLimits> = Object.freeze({
  segmentBytes: 16 * 1024 * 1024,
  runBytes: 256 * 1024 * 1024,
  eventBytes: 1024 * 1024,
  pendingBytes: 4 * 1024 * 1024,
  eventCount: 100_000,
});
export const TYPES = new Set(['session.start', 'session.end', 'protocol.armed', 'input.submitted', 'input.unknown', 'frame.accepted', 'frame.rejected', 'route.queued', 'route.delivered', 'route.failed', 'controller.feedback']);
export const AGENTS = new Set(['claude', 'codex', 'gemini', 'opencode', 'generic', 'aider', 'cline', 'goose', 'kiro', 'amp']);
export const VERBS = new Set(['send', 'reply', 'broadcast', 'status', 'query']);
export const INPUT_KINDS = new Set(['task', 'template', 'protocol', 'controller', 'demo', 'routed']);
export const COVERAGE = new Set(['commander-visible', 'missing-manual-input', 'truncated']);
export const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export const MACHINE_RE = /^[a-z][a-z0-9_]{0,63}$/u;
export const CAP_REF_RE = /^cap_[1-9][0-9]{0,5}$/u;
export const INPUT_KEYS = ['type', 'actor', 'target', 'verb', 'content', 'capabilityRef', 'targetAgent', 'targetPanel', 'emissionId', 'messageId', 'threadId', 'replyToMessageId', 'inputKind', 'outcome', 'reason', 'coverage'] as const;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function validPanel(value: unknown): value is number {
  return isPanelNumber(value);
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_:-]+$/u.test(value);
}
export function validateInput(value: unknown): value is CaptureInput {
  if (!isObject(value) || !TYPES.has(value.type as string)) return false;
  for (const key of ['actor', 'target']) {
    if (value[key] === undefined) continue;
    const actor = value[key];
    if (!isObject(actor) || !validId(actor.sessionId) || !validPanel(actor.panel) || !AGENTS.has(actor.agentType as string)) return false;
  }
  for (const key of ['emissionId', 'messageId', 'threadId', 'replyToMessageId']) {
    if (value[key] !== undefined && !validId(value[key])) return false;
  }
  for (const key of ['reason', 'outcome']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !MACHINE_RE.test(value[key]))) return false;
  }
  if (value.capabilityRef !== undefined && (typeof value.capabilityRef !== 'string' || !CAP_REF_RE.test(value.capabilityRef))) return false;
  if (value.targetAgent !== undefined && !AGENTS.has(value.targetAgent as string)) return false;
  if (value.targetPanel !== undefined && !validPanel(value.targetPanel)) return false;
  if (value.verb !== undefined && !VERBS.has(value.verb as string)) return false;
  if (value.inputKind !== undefined && !INPUT_KINDS.has(value.inputKind as string)) return false;
  if (value.coverage !== undefined && !COVERAGE.has(value.coverage as string)) return false;
  return value.content === undefined || typeof value.content === 'string';
}

export function validateStoredEvent(value: unknown, captureId: string, sequence: number): value is CaptureEvent {
  if (!validateInput(value) || !isObject(value)) return false;
  if (!exactKeys(value, [...INPUT_KEYS, 'schemaVersion', 'captureId', 'eventId', 'sequence', 'at', 'elapsedMs', 'contentBytes', 'redactions', 'contentOmitted'])) return false;
  if (value.schemaVersion !== 1 || value.captureId !== captureId || value.sequence !== sequence || value.eventId !== `${captureId}:event_${sequence}`) return false;
  if (typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at) return false;
  if (typeof value.elapsedMs !== 'number' || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) return false;
  if (typeof value.contentOmitted !== 'boolean' || (value.contentOmitted && value.content !== undefined)) return false;
  if (value.contentBytes !== undefined && (!Number.isSafeInteger(value.contentBytes) || (value.contentBytes as number) < 0 || (value.contentBytes as number) > 1024 * 1024)) return false;
  if (!isObject(value.redactions) || Object.keys(value.redactions).length > 16) return false;
  for (const [rule, count] of Object.entries(value.redactions)) {
    if (!MACHINE_RE.test(rule) || !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 1024 * 1024) return false;
  }
  const prefix = `${captureId}:`;
  for (const key of ['actor', 'target']) {
    const actor = value[key];
    if (actor !== undefined && (!isObject(actor) || !exactKeys(actor, ['sessionId', 'panel', 'agentType']) || !new RegExp(`^${prefix}session_[1-9][0-9]{0,5}$`, 'u').test(actor.sessionId as string))) return false;
  }
  for (const [key, kind] of [['emissionId', 'emission'], ['messageId', 'message'], ['replyToMessageId', 'message'], ['threadId', 'thread']]) {
    if (value[key] !== undefined && !new RegExp(`^${prefix}${kind}_[1-9][0-9]{0,5}$`, 'u').test(value[key] as string)) return false;
  }
  return true;
}
