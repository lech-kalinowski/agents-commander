import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { assertPrivate, checkAncestors, readPrivateFile } from './files.js';
import { CAPTURE_LIMITS, exactKeys, isObject, MACHINE_RE, UUID_RE, validateStoredEvent } from './schema.js';
import type { CaptureEvent, CaptureManifest, ReadCaptureResult } from './types.js';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MANIFEST_KEYS = ['schemaVersion', 'captureId', 'projectId', 'synthetic', 'mode', 'status', 'startedAt', 'endedAt', 'reason', 'redactionPolicy', 'limits', 'counts', 'segments'];

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function unsigned(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}
function parseJson(buffer: Buffer): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
}
export function validateCaptureManifest(value: unknown): asserts value is CaptureManifest {
  if (!isObject(value) || !exactKeys(value, MANIFEST_KEYS)
    || value.schemaVersion !== 1 || typeof value.captureId !== 'string' || !UUID_RE.test(value.captureId)
    || typeof value.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(value.projectId)
    || typeof value.synthetic !== 'boolean' || !['metadata', 'protocol'].includes(value.mode as string)
    || !['recording', 'complete', 'incomplete'].includes(value.status as string)
    || value.redactionPolicy !== 'commander-local-v1' || !timestamp(value.startedAt)
    || (value.status !== 'recording' && !timestamp(value.endedAt))
    || (value.reason !== undefined && (typeof value.reason !== 'string' || !MACHINE_RE.test(value.reason)))
    || !isObject(value.limits) || !isObject(value.counts) || !exactKeys(value.counts, ['events', 'bytes'])
    || !Array.isArray(value.segments) || value.segments.length > 32) throw new Error('Invalid or unsupported capture manifest');
  if (!exactKeys(value.limits, Object.keys(CAPTURE_LIMITS))) throw new Error('Invalid capture limits');
  for (const [key, limit] of Object.entries(CAPTURE_LIMITS)) {
    if (value.limits[key] !== limit) throw new Error('Unsupported capture limits');
  }
  if (!unsigned(value.counts.events, CAPTURE_LIMITS.eventCount) || !unsigned(value.counts.bytes, CAPTURE_LIMITS.runBytes)) throw new Error('Capture counts exceed limits');
  if (value.status === 'complete' && value.reason !== undefined) throw new Error('Complete capture cannot contain a failure reason');
  for (let i = 0; i < value.segments.length; i++) {
    const segment = value.segments[i];
    if (!isObject(segment) || !exactKeys(segment, ['file', 'bytes', 'events', 'sha256'])
      || segment.file !== `events-${String(i + 1).padStart(4, '0')}.jsonl`
      || !unsigned(segment.bytes, CAPTURE_LIMITS.segmentBytes) || segment.bytes === 0
      || !unsigned(segment.events, CAPTURE_LIMITS.eventCount) || segment.events === 0
      || typeof segment.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(segment.sha256)) throw new Error('Invalid capture segment');
  }
  const segmentBytes = value.segments.reduce((sum, segment) => sum + segment.bytes, 0);
  const segmentEvents = value.segments.reduce((sum, segment) => sum + segment.events, 0);
  if (segmentBytes !== value.counts.bytes || segmentEvents !== value.counts.events) throw new Error('Capture manifest segment totals do not match counts');
}

/** Strict offline reader: integrity validation is not permission to train on data. */
export async function readCaptureDirectory(
  directory: string,
  options: { requireComplete?: boolean; maxBytes?: number; maxEvents?: number } = {},
): Promise<ReadCaptureResult> {
  const maxBytes = options.maxBytes ?? CAPTURE_LIMITS.runBytes;
  const maxEvents = options.maxEvents ?? CAPTURE_LIMITS.eventCount;
  if (!unsigned(maxBytes, CAPTURE_LIMITS.runBytes) || !unsigned(maxEvents, CAPTURE_LIMITS.eventCount)) {
    throw new Error('Invalid capture reader budget');
  }
  await checkAncestors(directory);
  assertPrivate(await lstat(directory), true);
  const initialManifest = await readPrivateFile(path.join(directory, 'manifest.json'), MAX_MANIFEST_BYTES);
  const manifest = parseJson(initialManifest);
  validateCaptureManifest(manifest);
  if (manifest.counts.bytes > maxBytes || manifest.counts.events > maxEvents) throw new Error('Capture exceeds requested read budget');
  if (path.basename(directory) !== `capture-${manifest.captureId}`) throw new Error('Capture directory identity mismatch');
  if (options.requireComplete !== false && manifest.status !== 'complete') throw new Error('Capture is incomplete or still recording');
  const names = await readdir(directory);
  const expected = new Set(['manifest.json', ...manifest.segments.map((segment) => segment.file)]);
  if (names.length !== expected.size || names.some((name) => !expected.has(name))) throw new Error('Capture has unsealed or unexpected files');
  let totalBytes = 0;
  let elapsed = 0;
  const events: CaptureEvent[] = [];
  for (const segment of manifest.segments) {
    totalBytes += segment.bytes;
    if (totalBytes > maxBytes) throw new Error('Capture read exceeds run budget');
    const buffer = await readPrivateFile(path.join(directory, segment.file), CAPTURE_LIMITS.segmentBytes);
    if (buffer.length !== segment.bytes || createHash('sha256').update(buffer).digest('hex') !== segment.sha256) throw new Error('Capture segment checksum mismatch');
    if (buffer[buffer.length - 1] !== 10) throw new Error('Capture has a partial final record');
    let start = 0;
    let segmentEvents = 0;
    for (let end = 0; end < buffer.length; end++) {
      if (end - start + 1 > CAPTURE_LIMITS.eventBytes) throw new Error('Capture event exceeds read budget');
      if (buffer[end] !== 10) continue;
      if (events.length >= maxEvents) throw new Error('Capture has too many events');
      const event = parseJson(buffer.subarray(start, end));
      if (!validateStoredEvent(event, manifest.captureId, events.length + 1)) throw new Error('Invalid capture event');
      if (event.elapsedMs < elapsed) throw new Error('Capture monotonic time moved backwards');
      if (event.content !== undefined && (manifest.mode === 'metadata' || event.type === 'frame.rejected')) throw new Error('Capture payload violates mode policy');
      elapsed = event.elapsedMs;
      events.push(event); segmentEvents++; start = end + 1;
    }
    if (segmentEvents !== segment.events) throw new Error('Capture segment event count mismatch');
  }
  if (events.length !== manifest.counts.events || totalBytes !== manifest.counts.bytes) throw new Error('Capture totals do not match manifest');
  const finalManifest = await readPrivateFile(path.join(directory, 'manifest.json'), MAX_MANIFEST_BYTES);
  if (!initialManifest.equals(finalManifest)) throw new Error('Capture manifest changed during read');
  return { manifest, events, complete: manifest.status === 'complete' };
}
