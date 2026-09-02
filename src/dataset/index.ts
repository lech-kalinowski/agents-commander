import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readCaptureDirectory, validateCaptureManifest } from '../capture/reader.js';
import type { CaptureManifest, ReadCaptureResult } from '../capture/types.js';
import {
  assertRecord, canonical, DATASET_MAX_CANDIDATES, DATASET_MAX_CAPTURES,
  DATASET_MAX_SOURCE_BYTES, DATASET_MAX_SOURCE_EVENTS, jsonl, parseJson, parseJsonl,
  privateDirectory, readPrivateFile, sha256, writeNewDirectory,
} from './io.js';
import { candidatesFromCapture, SYMBOLIC_CAP } from './normalize.js';
import { assignProjectGroups, duplicateKey, groupCandidates } from './group.js';
import { CANDIDATE_SCHEMA, REVIEW_SCHEMA, TRAINING_ROW_SCHEMA } from './schema.js';
import { isHash, validateCandidate, validateReview, validateReviewDecision } from './validate.js';
import type { Candidate, ExportManifest, PreparedManifest, ReviewDecision, ReviewFile, Sidecar, SourceProvenance, TrainingRow } from './types.js';
export type { Candidate, ChatMessage, TrainingRow, ReviewDecision } from './types.js';

const SCHEMA_FILES = {
  '.gitignore': '*\n',
  'candidate.schema.json': `${canonical(CANDIDATE_SCHEMA)}\n`,
  'review.schema.json': `${canonical(REVIEW_SCHEMA)}\n`,
  'training-row.schema.json': `${canonical(TRAINING_ROW_SCHEMA)}\n`,
};
const SPLIT_FILES = ['train.jsonl', 'validation.jsonl', 'test.jsonl', 'synthetic.train.jsonl', 'synthetic.validation.jsonl', 'synthetic.test.jsonl'];
const hashFiles = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha256(content)]));
const countKinds = (capture: ReadCaptureResult) => {
  const counts: Record<string, number> = {};
  for (const event of capture.events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return counts;
};

async function readBoundedCapture(directory: string, requireComplete = true, maxBytes = DATASET_MAX_SOURCE_BYTES, maxEvents = DATASET_MAX_SOURCE_EVENTS): Promise<ReadCaptureResult> {
  const root = privateDirectory(directory);
  const manifest = parseJson(readPrivateFile(root, 'manifest.json', 64 * 1024), 'capture manifest') as CaptureManifest;
  if (!manifest?.counts || !Number.isSafeInteger(manifest.counts.bytes) || manifest.counts.bytes > maxBytes
    || !Number.isSafeInteger(manifest.counts.events) || manifest.counts.events > maxEvents) throw new Error('Capture exceeds offline dataset read budget');
  return readCaptureDirectory(root, { requireComplete, maxBytes, maxEvents });
}

export async function inspectCaptureDataset(directory: string) {
  const capture = await readBoundedCapture(directory, false);
  const result = candidatesFromCapture(capture);
  return {
    captureId: capture.manifest.captureId, projectId: capture.manifest.projectId,
    mode: capture.manifest.mode, status: capture.manifest.status, synthetic: capture.manifest.synthetic,
    counts: capture.manifest.counts, eventKinds: countKinds(capture),
    candidates: result.candidates.length, exclusions: result.exclusions,
    notice: 'Inspection is not quality, context, privacy or rights approval. No raw content is printed.',
  };
}

export async function prepareDataset(captureDirectories: readonly string[], options: { out: string }) {
  if (!Array.isArray(captureDirectories) || captureDirectories.length < 1 || captureDirectories.length > DATASET_MAX_CAPTURES) throw new Error(`Prepare requires 1-${DATASET_MAX_CAPTURES} captures`);
  const sources: SourceProvenance[] = [];
  const candidates: Candidate[] = [];
  const exclusions: PreparedManifest['exclusions'] = [];
  let sourceBytes = 0, sourceEvents = 0, candidateBytes = 0;
  const seen = new Set<string>();
  for (const directory of captureDirectories) {
    // Limits are enforced by the strict reader against its own validated manifest and actual allocations.
    const capture = await readBoundedCapture(directory, true, DATASET_MAX_SOURCE_BYTES - sourceBytes, DATASET_MAX_SOURCE_EVENTS - sourceEvents);
    sourceBytes += capture.manifest.counts.bytes; sourceEvents += capture.manifest.counts.events;
    if (capture.manifest.mode !== 'protocol') throw new Error('Dataset preparation requires protocol capture mode');
    if (seen.has(capture.manifest.captureId)) throw new Error('Duplicate capture input');
    seen.add(capture.manifest.captureId);
    sources.push({ captureId: capture.manifest.captureId, manifestSha256: sha256(canonical(capture.manifest)), manifest: capture.manifest });
    const result = candidatesFromCapture(capture);
    for (const candidate of result.candidates) {
      validateCandidate(candidate);
      candidateBytes += Buffer.byteLength(canonical(candidate));
      if (candidateBytes > 24 * 1024 * 1024) throw new Error('Combined candidate content budget exceeded');
      candidates.push(candidate);
    }
    exclusions.push(...result.exclusions);
    if (candidates.length > DATASET_MAX_CANDIDATES) throw new Error('Combined candidate budget exceeded');
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  sources.sort((a, b) => a.captureId.localeCompare(b.captureId));
  exclusions.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const grouped = groupCandidates(candidates);
  const files = { ...SCHEMA_FILES, 'candidates.jsonl': jsonl(candidates) };
  const manifest: PreparedManifest = {
    schemaVersion: 1, kind: 'commander-candidates', recipe: 'commander-wire-v1', candidates: candidates.length,
    candidatesSha256: sha256(files['candidates.jsonl']), sources, exclusions,
    splitGroups: grouped.groups, splitAssignments: grouped.assignments, warnings: grouped.warnings, files: hashFiles(files),
  };
  const manifestText = `${canonical(manifest)}\n`;
  const review: ReviewFile = {
    schemaVersion: 1, manifestSha256: sha256(manifestText), decisions: candidates.map((candidate) => ({
      candidateId: candidate.id, candidateSha256: sha256(canonical(candidate)), approved: false,
      quality: false, context: false, privacy: false, rights: false, reviewer: '', reviewedAt: null, notes: '',
    })),
  };
  const output = writeNewDirectory(options.out, {
    ...files,
    'review.json': `${JSON.stringify(review, null, 2)}\n`,
    'readme.md': `# Candidate review\n\nThese are NOT approved training examples. Do not edit candidates.jsonl or manifest.json. Inspect each candidate, then edit only review.json. Approve only after independently checking quality, context completeness, privacy and permission to train on the underlying project and provider output. Set all four review flags and approved to true, add a reviewer label and ISO reviewedAt timestamp. Delivery is not proof of correctness. Synthetic conditioning is explicitly marked and synthetic exports are separate. No training or upload occurs.\n\n${candidates.length} candidates; ${exclusions.length} exclusions. Retain these private files for provenance. The review digest is tied to this exact candidate manifest. Project-family and near-duplicate splits are frozen now, before review selection; approving a subset cannot reshuffle them.\n`,
    'manifest.json': manifestText,
  });
  return { directory: output, candidates: candidates.length, exclusions: exclusions.length, approved: 0, reviewFile: 'review.json' };
}

function verifyFiles(directory: string, value: unknown, required: readonly string[]): Record<string, Buffer> {
  assertRecord(value, [...required], 'file checksums');
  if (Object.keys(value).length !== required.length) throw new Error('Missing dataset files');
  const files: Record<string, Buffer> = {};
  let total = 0;
  for (const name of required) {
    if (!isHash(value[name])) throw new Error('Invalid file checksum');
    files[name] = readPrivateFile(directory, name);
    total += files[name].length;
    if (total > 128 * 1024 * 1024) throw new Error('Combined dataset files exceed read budget');
    if (sha256(files[name]) !== value[name]) throw new Error(`Dataset checksum mismatch: ${name}`);
  }
  return files;
}

function validateSources(value: unknown): asserts value is SourceProvenance[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DATASET_MAX_CAPTURES) throw new Error('Invalid dataset source provenance');
  const seen = new Set<string>();
  for (const source of value) {
    assertRecord(source, ['captureId', 'manifestSha256', 'manifest'], 'source provenance');
    const manifest = source.manifest as CaptureManifest;
    validateCaptureManifest(manifest);
    if (!manifest || typeof source.captureId !== 'string' || seen.has(source.captureId) || manifest.captureId !== source.captureId
      || manifest.schemaVersion !== 1 || manifest.mode !== 'protocol' || manifest.status !== 'complete'
      || !/^[A-Za-z0-9_-]{1,64}$/.test(manifest.projectId) || typeof manifest.synthetic !== 'boolean'
      || source.manifestSha256 !== sha256(canonical(manifest))) throw new Error('Invalid source manifest reference');
    seen.add(source.captureId);
  }
}

function checkCandidateSources(candidates: Candidate[], sources: SourceProvenance[]) {
  const manifests = new Map(sources.map((source) => [source.captureId, source.manifest]));
  const ids = new Set<string>();
  for (const candidate of candidates) {
    validateCandidate(candidate);
    const source = manifests.get(candidate.captureId);
    if (!source || source.projectId !== candidate.projectId || source.synthetic !== candidate.synthetic || ids.has(candidate.id)
      || candidate.sequence > source.counts.events) throw new Error('Candidate does not match source provenance');
    ids.add(candidate.id);
  }
}

function readPrepared(directory: string) {
  const root = privateDirectory(directory);
  const manifestData = readPrivateFile(root, 'manifest.json', 2 * 1024 * 1024);
  const parsed = parseJson(manifestData, 'candidate manifest');
  assertRecord(parsed, ['schemaVersion', 'kind', 'recipe', 'candidates', 'candidatesSha256', 'sources', 'exclusions', 'splitGroups', 'splitAssignments', 'warnings', 'files'], 'candidate manifest');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'commander-candidates' || parsed.recipe !== 'commander-wire-v1'
    || !Number.isSafeInteger(parsed.candidates) || Number(parsed.candidates) < 0 || Number(parsed.candidates) > DATASET_MAX_CANDIDATES) throw new Error('Unsupported candidate manifest');
  validateSources(parsed.sources);
  const files = verifyFiles(root, parsed.files, [...Object.keys(SCHEMA_FILES), 'candidates.jsonl']);
  for (const [name, content] of Object.entries(SCHEMA_FILES)) if (files[name].toString() !== content) throw new Error('Unsupported dataset schema');
  if (sha256(files['candidates.jsonl']) !== parsed.candidatesSha256) throw new Error('Candidate hash mismatch');
  const candidates = parseJsonl(files['candidates.jsonl'], 'candidates') as Candidate[];
  if (candidates.length !== parsed.candidates) throw new Error('Candidate count mismatch');
  checkCandidateSources(candidates, parsed.sources);
  const groups = groupCandidates(candidates);
  if (canonical(groups.groups) !== canonical(parsed.splitGroups) || canonical(groups.assignments) !== canonical(parsed.splitAssignments)
    || canonical(groups.warnings) !== canonical(parsed.warnings)) throw new Error('Frozen candidate splits do not match source groups');
  const reviewData = readPrivateFile(root, 'review.json', 8 * 1024 * 1024);
  const review = parseJson(reviewData, 'review');
  validateReview(review, candidates, sha256(manifestData));
  return { candidates, review, reviewData, manifest: parsed as unknown as PreparedManifest, manifestData };
}

export function renderTrainingRow(candidate: Candidate, seed: string): { row: TrainingRow; bindings: Record<string, string> } {
  const bindings: Record<string, string> = {};
  for (const [ref, owner] of Object.entries(candidate.capabilityOwners)) {
    bindings[ref] = createHash('sha256').update(canonical(['commander-synthetic-key-v1', seed, candidate.id, owner, ref])).digest('base64url');
  }
  const substitute = (content: string) => content.replace(SYMBOLIC_CAP, (_all, ref: string) => {
    if (!bindings[ref]) throw new Error('Missing synthetic capability binding');
    return bindings[ref];
  });
  const row: TrainingRow = {
    prompt: candidate.prompt.map((message) => ({ role: message.role, content: substitute(message.content) })),
    completion: [{ role: 'assistant', content: substitute(candidate.completion[0].content) }],
  };
  if (canonical(row).includes('<cap:') || !row.completion[0].content.endsWith(`===COMMANDER:END:${bindings[candidate.capabilityRef]}===`)) throw new Error('Unresolved exported protocol reference');
  return { row, bindings };
}

function validateSeed(seed: string) {
  if (typeof seed !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(seed)) throw new Error('Seed must be a non-secret label using 1-128 letters, digits, dot, dash or underscore');
}

export async function exportDataset(reviewDirectory: string, options: { out: string; seed: string }) {
  validateSeed(options.seed);
  const prepared = readPrepared(reviewDirectory);
  const reviews = new Map(prepared.review.decisions.map((review) => [review.candidateId, review]));
  const approved = prepared.candidates.filter((candidate) => reviews.get(candidate.id)!.approved).sort((a, b) => a.id.localeCompare(b.id));
  if (!approved.length) throw new Error('No explicitly approved candidates to export');
  const candidates: Candidate[] = [];
  const duplicateIds: string[] = [];
  const duplicates = new Set<string>();
  for (const candidate of approved) {
    const key = `${candidate.synthetic}:${duplicateKey(candidate)}`;
    if (duplicates.has(key)) duplicateIds.push(candidate.id);
    else { duplicates.add(key); candidates.push(candidate); }
  }
  // Keep the assignments frozen before human review; selection cannot reshuffle families.
  const grouped = { assignments: prepared.manifest.splitAssignments, warnings: prepared.manifest.warnings };
  const rows: Record<string, TrainingRow[]> = Object.fromEntries(SPLIT_FILES.map((name) => [name, []]));
  const sidecars: Sidecar[] = [];
  for (const candidate of candidates) {
    const { row, bindings } = renderTrainingRow(candidate, options.seed);
    const split = grouped.assignments[candidate.projectId];
    const filename = `${candidate.synthetic ? 'synthetic.' : ''}${split}.jsonl`;
    sidecars.push({
      candidateId: candidate.id, candidateSha256: sha256(canonical(candidate)), rowSha256: sha256(canonical(row)),
      split, synthetic: candidate.synthetic, syntheticConditioning: candidate.syntheticConditioning,
      row: rows[filename].length, capabilityBindings: bindings, decision: reviews.get(candidate.id)!,
    });
    rows[filename].push(row);
  }
  const counts = Object.fromEntries(SPLIT_FILES.map((name) => [name, rows[name].length]));
  const warnings = exportWarnings(grouped.warnings, counts);
  const files: Record<string, string> = {
    ...SCHEMA_FILES, ...Object.fromEntries(SPLIT_FILES.map((name) => [name, jsonl(rows[name])])),
    'source-candidates.jsonl': jsonl(approved), 'sidecar.jsonl': jsonl(sidecars),
    'review.json': prepared.reviewData.toString('utf8'),
    'preparation.json': prepared.manifestData.toString('utf8'),
    'training-config.json': `${canonical({ schemaVersion: 1, status: 'model-selection-required', trainer: { completion_only_loss: true, assistant_only_loss: false, packing: false }, requirements: ['Pin base model revision, tokenizer and chat-template hash.', 'Apply the model chat template exactly once.', 'Check decoded supervised tokens: completion only, nonzero length, complete END marker and EOS, no loss on context/metadata/padding.', 'Reject over-context examples; never silently truncate a protocol target.', 'No model download, tokenization or training has been performed.'] })}\n`,
    'dataset-card.md': `# Commander Protocol dataset\n\nRecipe: commander-wire-v1. ${candidates.length} reviewed examples; ${duplicateIds.length} exact duplicates excluded.\n\nReal captures use train/validation/test.jsonl. Synthetic demos use separate synthetic.train/validation/test.jsonl files; never report them as real agent data. Every model record contains ONLY prompt and completion; reviewer labels, event IDs and capture manifests stay in private sidecars. Synthetic conditioning is explicitly marked there.\n\nCoverage: observed Commander-mediated input and accepted frames, not full provider context. Training permission was explicitly asserted by the listed reviewers, not independently established by this software. Automatic redaction is not a privacy guarantee. Keep this directory private.\n\n${warnings.map((warning) => `- ${warning}`).join('\n')}\n\nUse TRL conversational prompt/completion with completion_only_loss=true and packing=false; apply the chosen chat template once. This artifact is model-neutral and has not been tokenized or trained. See training-config.json for the model-specific gate. LoRA/QLoRA weights require a compatible selected base model; no universal adapter is produced.\n`,
  };
  const manifest: ExportManifest = {
    schemaVersion: 1, kind: 'commander-dataset', recipe: 'commander-wire-v1', seed: options.seed,
    reviewManifestSha256: sha256(prepared.manifestData), reviewSha256: sha256(prepared.reviewData),
    sources: prepared.manifest.sources, counts, splitAssignments: grouped.assignments,
    warnings, excludedDuplicates: duplicateIds, files: hashFiles(files),
  };
  const directory = writeNewDirectory(options.out, { ...files, 'manifest.json': `${canonical(manifest)}\n` });
  await validateDataset(directory);
  return { directory, exported: candidates.length, synthetic: candidates.filter((candidate) => candidate.synthetic).length, counts, warnings };
}

function exportWarnings(frozenWarnings: string[], counts: Record<string, number>): string[] {
  const warnings = [...frozenWarnings];
  if (!counts['train.jsonl'] && !counts['synthetic.train.jsonl']) warnings.push('The approved selection has no training rows; this export cannot train a model until appropriate training-split examples are reviewed.');
  if ((!counts['validation.jsonl'] && !counts['synthetic.validation.jsonl']) || (!counts['test.jsonl'] && !counts['synthetic.test.jsonl'])) {
    warnings.push('The approved selection has an empty held-out split; collect and review independent project families before claiming held-out evaluation.');
  }
  return warnings;
}

export async function validateDataset(directory: string) {
  const root = privateDirectory(directory);
  const parsed = parseJson(readPrivateFile(root, 'manifest.json', 2 * 1024 * 1024), 'export manifest');
  assertRecord(parsed, ['schemaVersion', 'kind', 'recipe', 'seed', 'reviewManifestSha256', 'reviewSha256', 'sources', 'counts', 'splitAssignments', 'warnings', 'excludedDuplicates', 'files'], 'export manifest');
  if (parsed.schemaVersion !== 1 || parsed.kind !== 'commander-dataset' || parsed.recipe !== 'commander-wire-v1'
    || !isHash(parsed.reviewManifestSha256) || !isHash(parsed.reviewSha256)) throw new Error('Unsupported export manifest');
  validateSeed(parsed.seed as string);
  validateSources(parsed.sources);
  const expectedFiles = [...Object.keys(SCHEMA_FILES), ...SPLIT_FILES, 'source-candidates.jsonl', 'sidecar.jsonl', 'review.json', 'preparation.json', 'training-config.json', 'dataset-card.md'];
  const files = verifyFiles(root, parsed.files, expectedFiles);
  const actualNames = fs.readdirSync(root);
  if (actualNames.length !== expectedFiles.length + 1 || actualNames.some((name) => name !== 'manifest.json' && !expectedFiles.includes(name))) throw new Error('Unexpected files in dataset directory');
  for (const [name, content] of Object.entries(SCHEMA_FILES)) if (files[name].toString() !== content) throw new Error('Unsupported export schema');
  const trainingConfig = parseJson(files['training-config.json'], 'training config');
  assertRecord(trainingConfig, ['schemaVersion', 'status', 'trainer', 'requirements'], 'training config');
  assertRecord(trainingConfig.trainer, ['completion_only_loss', 'assistant_only_loss', 'packing'], 'training options');
  if (trainingConfig.schemaVersion !== 1 || trainingConfig.status !== 'model-selection-required'
    || trainingConfig.trainer.completion_only_loss !== true || trainingConfig.trainer.assistant_only_loss !== false
    || trainingConfig.trainer.packing !== false || !Array.isArray(trainingConfig.requirements)
    || trainingConfig.requirements.some((item) => typeof item !== 'string')) throw new Error('Invalid model-specific training gate');
  if (sha256(files['review.json']) !== parsed.reviewSha256) throw new Error('Review checksum mismatch');
  if (sha256(files['preparation.json']) !== parsed.reviewManifestSha256) throw new Error('Preparation manifest checksum mismatch');
  const preparation = parseJson(files['preparation.json'], 'preparation manifest') as PreparedManifest;
  if (preparation.schemaVersion !== 1 || preparation.kind !== 'commander-candidates' || preparation.recipe !== 'commander-wire-v1'
    || !Array.isArray(preparation.splitGroups) || preparation.splitGroups.length > DATASET_MAX_CANDIDATES
    || preparation.splitGroups.some((members) => !Array.isArray(members) || members.length < 1 || members.length > DATASET_MAX_CAPTURES
      || members.some((project) => typeof project !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(project)))
    || canonical(preparation.sources) !== canonical(parsed.sources)) throw new Error('Invalid frozen preparation provenance');
  const flattenedGroups = preparation.splitGroups.flat();
  if (new Set(flattenedGroups).size !== flattenedGroups.length) throw new Error('Duplicate project in frozen groups');
  const frozen = assignProjectGroups(preparation.splitGroups);
  if (canonical(frozen.assignments) !== canonical(parsed.splitAssignments)
    || canonical(frozen.assignments) !== canonical(preparation.splitAssignments)
    || canonical(frozen.warnings) !== canonical(preparation.warnings)) throw new Error('Frozen split assignments changed');
  const candidates = parseJsonl(files['source-candidates.jsonl'], 'source candidates') as Candidate[];
  if (!candidates.length) throw new Error('Empty export');
  checkCandidateSources(candidates, parsed.sources);
  const review = parseJson(files['review.json'], 'exported review');
  // Export retains the full review for provenance, including unapproved candidates; validate selected decisions separately.
  assertRecord(review, ['schemaVersion', 'manifestSha256', 'decisions'], 'exported review');
  if (review.schemaVersion !== 1 || review.manifestSha256 !== parsed.reviewManifestSha256 || !Array.isArray(review.decisions) || review.decisions.length > DATASET_MAX_CANDIDATES) throw new Error('Invalid exported review');
  const decisions = new Map<string, ReviewDecision>();
  for (const decision of review.decisions) {
    if (!decision || typeof decision.candidateId !== 'string' || decisions.has(decision.candidateId)) throw new Error('Duplicate or invalid exported review');
    decisions.set(decision.candidateId, decision);
  }
  for (const candidate of candidates) {
    const decision = decisions.get(candidate.id);
    validateReviewDecision(decision, candidate);
    if (!decision!.approved) throw new Error('Unapproved source candidate in export');
  }
  const selectedGroups = groupCandidates(candidates);
  for (const members of selectedGroups.groups) {
    if (members.some((project) => !frozen.assignments[project]) || new Set(members.map((project) => frozen.assignments[project])).size !== 1) throw new Error('Related or near-duplicate projects cross splits');
  }
  const duplicateIds: string[] = [], seen = new Set<string>();
  const selected = candidates.filter((candidate) => {
    const key = `${candidate.synthetic}:${duplicateKey(candidate)}`;
    if (seen.has(key)) { duplicateIds.push(candidate.id); return false; }
    seen.add(key); return true;
  });
  if (canonical(duplicateIds) !== canonical(parsed.excludedDuplicates)) throw new Error('Duplicate exclusions mismatch');
  const sidecars = parseJsonl(files['sidecar.jsonl'], 'sidecar') as Sidecar[];
  if (sidecars.length !== selected.length) throw new Error('Sidecar count mismatch');
  const rows = Object.fromEntries(SPLIT_FILES.map((name) => [name, parseJsonl(files[name], name)]));
  const counts = Object.fromEntries(SPLIT_FILES.map((name) => [name, rows[name].length]));
  if (canonical(counts) !== canonical(parsed.counts)) throw new Error('Split row count mismatch');
  const warnings = exportWarnings(frozen.warnings, counts);
  if (canonical(warnings) !== canonical(parsed.warnings)) throw new Error('Dataset limitations changed');
  const visited = new Set<string>();
  for (let index = 0; index < selected.length; index++) {
    const candidate = selected[index], sidecar = sidecars[index];
    assertRecord(sidecar, ['candidateId', 'candidateSha256', 'rowSha256', 'split', 'synthetic', 'syntheticConditioning', 'row', 'capabilityBindings', 'decision'], 'sidecar');
    const expected = renderTrainingRow(candidate, parsed.seed as string);
    const split = frozen.assignments[candidate.projectId];
    const name = `${candidate.synthetic ? 'synthetic.' : ''}${split}.jsonl`;
    const rowIndex = sidecar.row as number;
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || !rows[name][rowIndex] || visited.has(`${name}:${rowIndex}`)) throw new Error('Invalid sidecar row reference');
    const row = rows[name][rowIndex];
    assertRecord(row, ['prompt', 'completion'], 'training row');
    // Canonical source validation precedes substitution; rendered live-format keys are deliberately synthetic.
    if (canonical(row) !== canonical(expected.row) || sidecar.candidateId !== candidate.id
      || sidecar.candidateSha256 !== sha256(canonical(candidate)) || sidecar.rowSha256 !== sha256(canonical(row))
      || sidecar.split !== split || sidecar.synthetic !== candidate.synthetic || sidecar.syntheticConditioning !== candidate.syntheticConditioning
      || canonical(sidecar.capabilityBindings) !== canonical(expected.bindings)
      || canonical(sidecar.decision) !== canonical(decisions.get(candidate.id))) throw new Error('Training row, protocol binding or approval mismatch');
    visited.add(`${name}:${rowIndex}`);
  }
  if (visited.size !== Object.values(counts).reduce((sum, count) => sum + count, 0)) throw new Error('Unreferenced training row');
  return { valid: true, examples: selected.length, counts, warnings };
}
