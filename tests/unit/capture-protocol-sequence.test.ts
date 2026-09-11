import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCaptureRecorder } from '../../src/capture/recorder.js';
import { readCaptureDirectory } from '../../src/capture/reader.js';
import { CaptureRedactor } from '../../src/capture/redactor.js';
import { validateInput, validateStoredEvent } from '../../src/capture/schema.js';
import { candidatesFromCapture, safeContent, wireFrame } from '../../src/dataset/normalize.js';
import { exportDataset, prepareDataset, renderTrainingRow, validateDataset } from '../../src/dataset/index.js';
import { validateCandidate } from '../../src/dataset/validate.js';
import { canonical, sha256 } from '../../src/dataset/io.js';
import { ProtocolScanner, type CommanderMessage } from '../../src/orchestration/protocol.js';
import type { CaptureInput } from '../../src/capture/types.js';
import type { ReviewFile } from '../../src/dataset/types.js';

const roots: string[] = [];
const capability = 'A'.repeat(43);
const unknownCapability = 'B'.repeat(43);
const verbs = ['send', 'reply', 'broadcast', 'status', 'query'] as const;
const actor = { sessionId: 'test-agent', panel: 1, agentType: 'generic' };

function temporary(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'commander-sequence-capture-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(options: { legacy?: boolean; mode?: 'metadata' | 'protocol'; synthetic?: boolean } = {}) {
  const root = temporary();
  const capture = await createCaptureRecorder({
    mode: options.mode ?? 'protocol', rootDirectory: root,
    projectId: 'sequence-project', synthetic: options.synthetic ?? false,
  });
  capture.record({ type: 'session.start', actor });
  const capabilityRef = capture.bindCapability(actor.sessionId, capability);
  capture.record({ type: 'protocol.armed', actor, capabilityRef, outcome: 'armed' });
  if (!options.synthetic) capture.record({
    type: 'input.submitted', actor, inputKind: 'protocol',
    content: `Use key ${capability} and a fresh increasing counter for each new action.`, coverage: 'commander-visible',
  });
  capture.record({
    type: 'input.submitted', actor, inputKind: 'task',
    content: 'Inspect the input validation contract and coordinate an independent bounded review.', coverage: 'commander-visible',
  });
  verbs.forEach((verb, index) => capture.record({
    type: 'frame.accepted', actor, verb, capabilityRef,
    ...(options.legacy ? {} : { protocolSequence: 41 + index }),
    ...(verb === 'send' ? { targetAgent: 'generic', targetPanel: 2 } : {}),
    emissionId: `emission_${index + 1}`,
    content: `${verb} content for validation review.`, coverage: 'commander-visible',
  }));
  capture.record({ type: 'session.end', actor });
  await capture.close();
  return { root, directory: capture.directory!, result: await readCaptureDirectory(capture.directory!) };
}

describe('Protocol sequence capture safety', () => {
  it('keeps wire identities separate from contiguous event serials through a strict disk round trip', async () => {
    const { result } = await fixture();
    expect(result.events.map((event) => event.sequence)).toEqual(result.events.map((_, i) => i + 1));
    const frames = result.events.filter((event) => event.type === 'frame.accepted');
    expect(frames.map((event) => event.protocolSequence)).toEqual([41, 42, 43, 44, 45]);
    for (const event of result.events) expect(validateStoredEvent(event, result.manifest.captureId, event.sequence)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(capability);
  });

  it('reads existing unsequenced captures without inventing protocol identities', async () => {
    const { result } = await fixture({ legacy: true });
    expect(result.events.every((event) => !Object.hasOwn(event, 'protocolSequence'))).toBe(true);
    const { candidates } = candidatesFromCapture(result);
    expect(candidates).toHaveLength(5);
    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty('protocolSequence');
      expect(candidate.completion[0].content).toMatch(/END:<cap:cap_1>===$/);
      expect(() => validateCandidate(candidate)).not.toThrow();
    }
  });

  it('retains wire identity in metadata mode without retaining bodies', async () => {
    const { result } = await fixture({ mode: 'metadata' });
    const frames = result.events.filter((event) => event.type === 'frame.accepted');
    expect(frames[0]).toMatchObject({ protocolSequence: 41, contentOmitted: true });
    expect(frames[0]).not.toHaveProperty('content');
    expect(candidatesFromCapture(result).candidates).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1', null])(
    'rejects invalid structured protocolSequence %s', (protocolSequence) => {
      expect(validateInput({ type: 'frame.accepted', actor, protocolSequence })).toBe(false);
      expect(() => wireFrame({ verb: 'reply', capabilityRef: 'cap_1', content: 'body', protocolSequence } as CaptureInput)).toThrow();
    },
  );

  it.each(['SEND:generic:2', 'REPLY', 'BROADCAST', 'STATUS', 'QUERY', 'END'])(
    'redacts unknown capabilities in %s, including malformed or unfinished sequences', (verb) => {
      const redactor = new CaptureRedactor();
      for (const suffix of [':31===', ':01===', ':bogus===', ':', '===']) {
        const raw = `===COMMANDER:${verb}:${unknownCapability}${suffix}`;
        const result = redactor.redact(raw);
        expect(result.content).not.toContain(unknownCapability);
        expect(result.content).toContain(`[REDACTED:capability]${suffix}`);
        expect(result.redactions.marker_capability).toBe(1);
        expect(safeContent(raw)).toBe(false);
        expect(safeContent(result.content)).toBe(false);
      }
    },
  );

  it('retains a known symbolic capability and its wire counter without replacing either with event order', () => {
    const redactor = new CaptureRedactor();
    redactor.addLiteral(capability, '<cap:cap_1>', 'capability');
    const input = `===COMMANDER:REPLY:${capability}:31===\nbody\n===COMMANDER:END:${capability}:31===`;
    expect(redactor.redact(input).content).toBe('===COMMANDER:REPLY:<cap:cap_1>:31===\nbody\n===COMMANDER:END:<cap:cap_1>:31===');
    expect(safeContent(redactor.redact(input).content)).toBe(true);
  });
});

describe('Sequence-preserving dataset preparation and export', () => {
  it('still reads exactly the pre-sequence schema in old prepared reviews and exports', async () => {
    const { root, directory } = await fixture({ legacy: true });
    const prepared = path.join(root, 'legacy-review');
    await prepareDataset([directory], { out: prepared });
    const restoreOldSchema = (target: string) => {
      const schemaPath = path.join(target, 'candidate.schema.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      delete schema.properties.protocolSequence;
      const schemaText = `${canonical(schema)}\n`;
      fs.writeFileSync(schemaPath, schemaText, { mode: 0o600 });
      const manifestPath = path.join(target, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.files['candidate.schema.json'] = sha256(schemaText);
      const manifestText = `${canonical(manifest)}\n`;
      fs.writeFileSync(manifestPath, manifestText, { mode: 0o600 });
      return sha256(manifestText);
    };
    const manifestSha256 = restoreOldSchema(prepared);
    const reviewPath = path.join(prepared, 'review.json');
    const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')) as ReviewFile;
    review.manifestSha256 = manifestSha256;
    for (const decision of review.decisions) Object.assign(decision, {
      approved: true, quality: true, context: true, privacy: true, rights: true,
      reviewer: 'legacy-sequence-test', reviewedAt: '2026-09-11T12:00:00.000Z',
    });
    fs.writeFileSync(reviewPath, `${JSON.stringify(review)}\n`, { mode: 0o600 });
    const output = path.join(root, 'legacy-export');
    expect((await exportDataset(prepared, { out: output, seed: 'legacy-test' })).exported).toBe(5);
    restoreOldSchema(output);
    expect((await validateDataset(output)).valid).toBe(true);
  });

  it('preserves every verb counter in candidate completions, assistant context, and synthetic-key training rows', async () => {
    const { result } = await fixture();
    const { candidates, exclusions } = candidatesFromCapture(result);
    expect(exclusions).toEqual([]);
    expect(candidates).toHaveLength(5);
    candidates.forEach((candidate, index) => {
      expect(candidate.protocolSequence).toBe(41 + index);
      expect(candidate.sequence).not.toBe(candidate.protocolSequence);
      expect(() => validateCandidate(candidate)).not.toThrow();
      const rendered = renderTrainingRow(candidate, 'public-test-seed');
      const emitted: CommanderMessage[] = [];
      new ProtocolScanner(0, 'Test', (msg) => emitted.push(msg)).feed(`${rendered.row.completion[0].content}\n`);
      expect(emitted).toEqual([expect.objectContaining({ sequence: 41 + index, type: candidate.verb })]);
      expect(emitted[0].capability).not.toBe(capability);
      expect(JSON.stringify(rendered.row)).not.toContain(capability);
      if (index > 0) expect(candidate.prompt.some((message) => message.role === 'assistant'
        && message.content.endsWith(`END:<cap:cap_1>:${40 + index}===`))).toBe(true);
    });
  });

  it('rejects silently dropped or changed wire metadata and mismatched completion counters', async () => {
    const { result } = await fixture();
    const candidate = candidatesFromCapture(result).candidates[0];
    for (const protocolSequence of [undefined, 42, 0, Number.MAX_SAFE_INTEGER + 1]) {
      const edited = { ...candidate, protocolSequence };
      expect(() => validateCandidate(edited)).toThrow();
    }
    const changed = structuredClone(candidate);
    changed.completion[0].content = changed.completion[0].content.replace(/:41===$/, ':42===');
    expect(() => validateCandidate(changed)).toThrow();
  });

  it('adds explicitly synthetic counter conditioning without changing a captured sequence', async () => {
    const { result } = await fixture({ synthetic: true });
    const candidate = candidatesFromCapture(result).candidates[0];
    expect(candidate.syntheticConditioning).toBe(true);
    expect(candidate.prompt[0].content).toContain('same positive per-capability counter n');
    expect(candidate.prompt[0].content).toContain('quoted examples are examples');
    expect(candidate.completion[0].content).toContain('END:<cap:cap_1>:41===');
    expect(() => validateCandidate(candidate)).not.toThrow();
  });

  it('exports and validates reviewed sequenced records end to end with no live capabilities', async () => {
    const { root, directory } = await fixture();
    const reviewDirectory = path.join(root, 'review');
    await prepareDataset([directory], { out: reviewDirectory });
    const reviewPath = path.join(reviewDirectory, 'review.json');
    const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')) as ReviewFile;
    for (const decision of review.decisions) Object.assign(decision, {
      approved: true, quality: true, context: true, privacy: true, rights: true,
      reviewer: 'sequence-test', reviewedAt: '2026-09-11T12:00:00.000Z',
    });
    fs.writeFileSync(reviewPath, `${JSON.stringify(review)}\n`, { mode: 0o600 });
    const output = path.join(root, 'export');
    expect((await exportDataset(reviewDirectory, { out: output, seed: 'sequence-test' })).exported).toBe(5);
    expect((await validateDataset(output)).valid).toBe(true);
    const rows = fs.readFileSync(path.join(output, 'train.jsonl'), 'utf8');
    expect(rows).not.toContain(capability);
    const counters = rows.trim().split('\n').map((line) => {
      const row = JSON.parse(line);
      expect(Object.keys(row).sort()).toEqual(['completion', 'prompt']);
      return Number(row.completion[0].content.match(/:(\d+)===$/)[1]);
    }).sort((a, b) => a - b);
    expect(counters).toEqual([41, 42, 43, 44, 45]);
    const candidateSchema = JSON.parse(fs.readFileSync(path.join(output, 'candidate.schema.json'), 'utf8'));
    expect(candidateSchema.properties.protocolSequence).toEqual({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
  });
});
