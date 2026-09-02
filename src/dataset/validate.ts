import { assertRecord, canonical, DATASET_MAX_CANDIDATES, sha256 } from './io.js';
import { safeContent, SYMBOLIC_CAP, wireFrame } from './normalize.js';
import type { Candidate, ChatMessage, ReviewDecision, ReviewFile } from './types.js';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_:-]{1,200}$/;
const CANDIDATE_KEYS = ['schemaVersion', 'id', 'captureId', 'projectId', 'synthetic', 'syntheticConditioning', 'sessionId', 'emissionId', 'eventId', 'sequence', 'sourceEventIds', 'capabilityRef', 'capabilityOwners', 'verb', 'targetAgent', 'targetPanel', 'coverage', 'prompt', 'completion'];
const REVIEW_KEYS = ['candidateId', 'candidateSha256', 'approved', 'quality', 'context', 'privacy', 'rights', 'reviewer', 'reviewedAt', 'notes'];
export function isHash(value: unknown): value is string { return typeof value === 'string' && HASH.test(value); }
function identifier(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }

export function validateMessages(value: unknown, completion = false): asserts value is ChatMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > (completion ? 1 : 128)) throw new Error('Invalid message list');
  for (const message of value) {
    assertRecord(message, ['role', 'content'], 'chat message');
    if (!(completion ? message.role === 'assistant' : message.role === 'user' || message.role === 'assistant')
      || !safeContent(message.content)) throw new Error('Invalid chat message');
  }
  if (Buffer.byteLength(canonical(value)) > (completion ? 40 * 1024 : 256 * 1024)) throw new Error('Message context exceeds dataset budget');
}

export function validateCandidate(value: unknown): asserts value is Candidate {
  assertRecord(value, CANDIDATE_KEYS, 'candidate');
  if (value.schemaVersion !== 1 || value.coverage !== 'commander-visible' || typeof value.synthetic !== 'boolean'
    || typeof value.syntheticConditioning !== 'boolean' || value.syntheticConditioning && !value.synthetic
    || !identifier(value.id) || !identifier(value.captureId) || !identifier(value.projectId)
    || !identifier(value.sessionId) || !identifier(value.emissionId) || !identifier(value.eventId)
    || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1
    || typeof value.capabilityRef !== 'string' || !/^cap_[1-9]\d*$/.test(value.capabilityRef)) throw new Error('Invalid candidate identity');
  if (!Array.isArray(value.sourceEventIds) || value.sourceEventIds.length < 1 || value.sourceEventIds.length > 512
    || value.sourceEventIds.some((id) => !identifier(id)) || new Set(value.sourceEventIds).size !== value.sourceEventIds.length
    || value.sourceEventIds.at(-1) !== value.eventId) throw new Error('Invalid candidate event references');
  for (const id of [value.sessionId, value.emissionId, value.eventId, ...value.sourceEventIds]) {
    if (!id.startsWith(`${value.captureId}:`)) throw new Error('Cross-capture candidate event reference');
  }
  assertRecord(value.capabilityOwners, Object.keys(value.capabilityOwners as object ?? {}), 'capability owners');
  const owners = value.capabilityOwners;
  if (Object.keys(owners).length > 256 || owners[value.capabilityRef] !== value.sessionId) throw new Error('Invalid current capability owner');
  for (const [ref, owner] of Object.entries(owners)) {
    if (!/^cap_[1-9]\d*$/.test(ref) || !identifier(owner) || !owner.startsWith(`${value.captureId}:`)) throw new Error('Invalid capability binding');
  }
  validateMessages(value.prompt);
  validateMessages(value.completion, true);
  const candidate = value as unknown as Candidate;
  const body = candidate.completion[0].content.split('\n').slice(1, -1).join('\n');
  if (wireFrame({ ...candidate, content: body }) !== candidate.completion[0].content) throw new Error('Candidate protocol frame is invalid');
  const used = [...canonical([value.prompt, value.completion]).matchAll(SYMBOLIC_CAP)].map((match) => match[1]);
  if (used.some((ref) => !owners[ref]) || Object.keys(owners).some((ref) => !used.includes(ref))) throw new Error('Unresolved capability reference');
  const expectedId = `candidate_${sha256(`${candidate.captureId}:${candidate.emissionId}`).slice(0, 32)}`;
  if (candidate.id !== expectedId) throw new Error('Candidate emission identity mismatch');
}

export function validateReviewDecision(value: unknown, candidate: Candidate): asserts value is ReviewDecision {
  assertRecord(value, REVIEW_KEYS, 'review decision');
  if (value.candidateId !== candidate.id || value.candidateSha256 !== sha256(canonical(candidate))
    || ['approved', 'quality', 'context', 'privacy', 'rights'].some((key) => typeof value[key] !== 'boolean')
    || typeof value.reviewer !== 'string' || value.reviewer.length > 200
    || typeof value.notes !== 'string' || value.notes.length > 4000
    || /[\u0000-\u001f\u007f-\u009f]/u.test(`${value.reviewer}${value.notes}`)
    || !(value.reviewedAt === null || typeof value.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.reviewedAt) && Number.isFinite(Date.parse(value.reviewedAt))
      && new Date(value.reviewedAt).toISOString() === value.reviewedAt)) throw new Error('Invalid or stale candidate review');
  if (value.approved && (!value.quality || !value.context || !value.privacy || !value.rights
    || !value.reviewer.trim() || !value.reviewedAt)) throw new Error('Approved candidate requires explicit quality, context, privacy and rights review with reviewer/date');
}

export function validateReview(value: unknown, candidates: readonly Candidate[], manifestHash: string): asserts value is ReviewFile {
  assertRecord(value, ['schemaVersion', 'manifestSha256', 'decisions'], 'review file');
  if (value.schemaVersion !== 1 || value.manifestSha256 !== manifestHash || !Array.isArray(value.decisions)
    || value.decisions.length !== candidates.length || value.decisions.length > DATASET_MAX_CANDIDATES) throw new Error('Review does not match candidate manifest');
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  for (const decision of value.decisions) {
    const candidate = byId.get(decision?.candidateId);
    if (!candidate || seen.has(candidate.id)) throw new Error('Unknown or duplicate review candidate');
    validateReviewDecision(decision, candidate);
    seen.add(candidate.id);
  }
}
