import { afterEach, describe, expect, it } from 'vitest';
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCaptureRecorder, NOOP_CAPTURE } from '../../src/capture/recorder.js';
import { readCaptureDirectory } from '../../src/capture/reader.js';
import { CAPTURE_LIMITS } from '../../src/capture/schema.js';
import type { CaptureInput, CaptureRecorder } from '../../src/capture/types.js';

const roots: string[] = [];
const actor = { sessionId: 'codex-private-profile_1_x_1', panel: 1, agentType: 'codex' };
const peer = { sessionId: 'claude-private-profile_2_x_2', panel: 2, agentType: 'claude' };
const key = 'A'.repeat(43);

async function temporaryRoot() {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'commander-capture-test-'));
  roots.push(root);
  return root;
}
async function recorder(mode: 'metadata' | 'protocol' = 'protocol', extra = {}) {
  const root = await temporaryRoot();
  return createCaptureRecorder({ mode, rootDirectory: root, projectId: 'opaque-project', synthetic: true, ...extra });
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('local capture recorder', () => {
  it('off is filesystem-free even with invalid paths or identities', async () => {
    const capture = await createCaptureRecorder({ mode: 'off', rootDirectory: '/unwritable/never', projectId: '../invalid' });
    expect(capture).toBe(NOOP_CAPTURE);
    capture.record({ type: 'session.start', actor });
    expect(capture.bindCapability(actor.sessionId, key)).toBe('');
    await capture.close();
    expect(capture.snapshot()).toMatchObject({ state: 'off', events: 0 });
    expect(capture.directory).toBeUndefined();
  });

  it('records immutable allowlisted events with private files and consistent identity mapping', async () => {
    const capture = await recorder();
    const ref = capture.bindCapability(actor.sessionId, key);
    const input = { type: 'frame.accepted', actor: { ...actor }, target: peer, verb: 'send', emissionId: 'emit_1', messageId: 'msg_1', threadId: 'thr_1', capabilityRef: ref, content: `===COMMANDER:SEND:claude:2:${key}===\nDo work\n===COMMANDER:END:${key}===`, unexpected: 'never persist this', env: { SECRET: 'never persist this either' } } as CaptureInput;
    capture.record(input);
    input.actor!.sessionId = 'mutated'; input.content = 'changed';
    capture.record({ type: 'route.delivered', actor, target: peer, emissionId: 'emit_1', messageId: 'msg_2', threadId: 'thr_1', replyToMessageId: 'msg_1' });
    await capture.close();
    const result = await readCaptureDirectory(capture.directory!);
    expect(result.complete).toBe(true);
    expect(result.manifest).toMatchObject({ projectId: 'opaque-project', synthetic: true, mode: 'protocol', status: 'complete' });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].actor).toEqual(result.events[1].actor);
    expect(result.events[0].messageId).toBe(result.events[1].replyToMessageId);
    expect(result.events[0].emissionId).toBe(result.events[1].emissionId);
    expect(result.events[0].content).toContain('<cap:cap_1>');
    const disk = JSON.stringify(result);
    for (const secret of [key, actor.sessionId, 'never persist', 'mutated']) expect(disk).not.toContain(secret);
    expect((await lstat(capture.directory!)).mode & 0o777).toBe(0o700);
    for (const name of await readdir(capture.directory!)) expect((await lstat(path.join(capture.directory!, name))).mode & 0o777).toBe(0o600);
    expect(capture.close()).toBe(capture.close());
    expect(capture.snapshot()).toMatchObject({ state: 'complete', events: 2, pendingBytes: 0 });
  });

  it('metadata drops bodies and rejected frames remain metadata-only in protocol mode', async () => {
    for (const mode of ['metadata', 'protocol'] as const) {
      const capture = await recorder(mode);
      capture.record({ type: 'frame.rejected', actor, content: 'untrusted secret', reason: 'unauthorized' });
      if (mode === 'metadata') capture.record({ type: 'input.submitted', actor, content: 'operator password' });
      await capture.close();
      const result = await readCaptureDirectory(capture.directory!);
      expect(result.events.every((event) => event.content === undefined && event.contentOmitted)).toBe(true);
    }
  });

  it('retains rotated capability redaction and handles known/common secrets', async () => {
    const capture = await recorder('protocol', { knownSecrets: ['literal-secret-1234'] });
    capture.bindCapability(actor.sessionId, key);
    const second = 'B'.repeat(43);
    expect(capture.bindCapability(actor.sessionId, second)).toBe('cap_2');
    expect(capture.capabilityRef(actor.sessionId)).toBe('cap_2');
    capture.record({ type: 'input.submitted', actor, content: `${key} ${second} literal-secret-1234 sk-1234567890abcdefghijklmnop password=hunter22 /Users/sensitive/project \u001b[31m` });
    await capture.close();
    const result = await readCaptureDirectory(capture.directory!);
    const text = result.events[0].content!;
    for (const secret of [key, second, 'literal-secret-1234', 'sk-1234567890', 'hunter22', '/Users/sensitive', '\u001b']) expect(text).not.toContain(secret);
    expect(text).toContain('<cap:cap_1>'); expect(text).toContain('<cap:cap_2>');
    expect(result.events[0].redactions).toMatchObject({ capability: 2, known_secret: 1, token: 1, credential_assignment: 1, home_path: 1, terminal_control: 1 });
  });

  it('isolates throwing status observers and unsupported runtime input', async () => {
    const capture = await recorder('protocol', { onStatus: () => { throw new Error('observer failed'); } });
    capture.record({ type: 'session.start', actor });
    expect(() => capture.record({ type: 'session.end', actor, reason: '/private/full/error/secret' })).not.toThrow();
    expect(capture.snapshot()).toMatchObject({ state: 'incomplete', reason: 'invalid_event' });
    await capture.close();
    await expect(readCaptureDirectory(capture.directory!)).rejects.toThrow('incomplete');
    const result = await readCaptureDirectory(capture.directory!, { requireComplete: false });
    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(1);
  });

  it('fails incomplete rather than truncating oversized content', async () => {
    const capture = await recorder();
    capture.record({ type: 'input.submitted', actor, content: '🦄'.repeat(200_000) });
    expect(capture.snapshot()).toMatchObject({ state: 'incomplete', reason: 'content_limit', events: 0 });
    await capture.close();
    await expect(readCaptureDirectory(capture.directory!)).rejects.toThrow('incomplete');
  });

  it('bounds pending write memory before the disk worker runs', async () => {
    const capture = await recorder();
    for (let i = 0; i < 30; i++) capture.record({ type: 'input.submitted', actor, content: 'safe '.repeat(45_000) });
    expect(capture.snapshot()).toMatchObject({ state: 'incomplete', reason: 'writer_backpressure' });
    expect(capture.snapshot().pendingBytes).toBeLessThanOrEqual(CAPTURE_LIMITS.pendingBytes);
    await capture.close();
    expect(capture.snapshot().pendingBytes).toBe(0);
  });

  it('allows a maximum default protocol body plus its forwarding envelope', async () => {
    const capture = await recorder();
    const content = 'a'.repeat(256 * 1024);
    capture.record({ type: 'frame.accepted', actor, verb: 'send', content });
    capture.record({ type: 'input.submitted', actor, target: peer, inputKind: 'routed', content: `[From Codex CLI in Panel 1 | thread=thr_1 | msg=msg_1]: ${content}` });
    await capture.close();
    expect((await readCaptureDirectory(capture.directory!)).events).toHaveLength(2);
  });

  it('isolates storage failure without throwing from record or close', async () => {
    const capture = await recorder();
    await chmod(capture.directory!, 0o500);
    capture.record({ type: 'session.start', actor });
    await expect(capture.close()).resolves.toBeUndefined();
    expect(capture.snapshot().state).toBe('incomplete');
    await chmod(capture.directory!, 0o700);
    await expect(readCaptureDirectory(capture.directory!)).rejects.toThrow('incomplete');
  });

  it('keeps independently opened runs isolated', async () => {
    const root = await temporaryRoot();
    const captures = await Promise.all([1, 2].map(() => createCaptureRecorder({ mode: 'protocol', rootDirectory: root, projectId: 'same-family' })));
    for (const capture of captures) { capture.record({ type: 'session.start', actor }); await capture.close(); }
    expect(captures[0].directory).not.toBe(captures[1].directory);
    const results = await Promise.all(captures.map((capture) => readCaptureDirectory(capture.directory!)));
    expect(results[0].events[0].actor!.sessionId).not.toBe(results[1].events[0].actor!.sessionId);
  });

  it('drains an event admitted after the active flush loop exits but before its finally', async () => {
    const capture = await recorder();
    const internal = capture as CaptureRecorder & { flush: () => Promise<void>; flushQueue: () => Promise<void> };
    const originalFlush = internal.flushQueue.bind(internal);
    let injected = false;
    let closed: Promise<void> | undefined;
    internal.flushQueue = async () => {
      await originalFlush();
      if (!injected) {
        injected = true;
        capture.record({ type: 'session.end', actor, reason: 'shutdown' });
        closed = capture.close();
      }
    };
    capture.record({ type: 'session.start', actor });
    await internal.flush();
    await closed;
    const result = await readCaptureDirectory(capture.directory!);
    expect(result.events).toHaveLength(2);
    expect(result.manifest.counts.events).toBe(capture.snapshot().events);
    expect(result.manifest.counts.bytes).toBe(capture.snapshot().bytes);
    expect(capture.snapshot().pendingBytes).toBe(0);
  });

  it('snapshots validated identity and callbacks instead of retaining mutable options', async () => {
    const root = await temporaryRoot();
    const options = { mode: 'protocol' as const, rootDirectory: root, projectId: 'approved-project', synthetic: true, onStatus: () => {} };
    const pending = createCaptureRecorder(options);
    options.projectId = '/private/secret-project'; options.synthetic = false;
    options.onStatus = () => { throw new Error('unexpected new callback'); };
    const capture = await pending;
    capture.record({ type: 'session.start', actor });
    await capture.close();
    expect((await readCaptureDirectory(capture.directory!)).manifest).toMatchObject({ projectId: 'approved-project', synthetic: true });
  });

  it('caps capability dictionaries instead of silently forgetting old keys', async () => {
    const capture = await recorder();
    for (let i = 0; i < 520; i++) capture.bindCapability(actor.sessionId, `${String(i).padStart(8, '0')}${'k'.repeat(35)}`);
    expect(capture.snapshot()).toMatchObject({ state: 'incomplete', reason: 'capability_redaction_failed' });
    await capture.close();
  });

  it('rotates complete segments without dropping records or changing their order', async () => {
    const capture = await recorder();
    const internal = capture as CaptureRecorder & { flush: () => Promise<void> };
    for (let batch = 0; batch < 8; batch++) {
      for (let i = 0; i < 10; i++) capture.record({ type: 'input.submitted', actor, content: `batch ${batch} event ${i}\n${'safe '.repeat(45_000)}` });
      await internal.flush();
    }
    await capture.close();
    const result = await readCaptureDirectory(capture.directory!);
    expect(result.manifest.segments).toHaveLength(2);
    expect(result.events).toHaveLength(80);
    expect(result.events[79].sequence).toBe(80);
    expect(result.manifest.segments.every((segment) => segment.bytes <= CAPTURE_LIMITS.segmentBytes)).toBe(true);
  }, 15000);

  it.each(['bytes', 'events'])('enforces the total %s budget independently of pending memory', async (field) => {
    const capture = await recorder();
    const internal = capture as unknown as Record<string, unknown>;
    internal[field] = field === 'bytes' ? CAPTURE_LIMITS.runBytes : CAPTURE_LIMITS.eventCount;
    capture.record({ type: 'session.start', actor });
    expect(capture.snapshot()).toMatchObject({ state: 'incomplete', reason: 'capture_limit' });
    await capture.close();
  });

  it('bounds close when storage flushing never settles', async () => {
    const capture = await recorder();
    const internal = capture as CaptureRecorder & { flush: () => Promise<void> };
    internal.flush = () => new Promise(() => {});
    const before = Date.now();
    await capture.close();
    expect(Date.now() - before).toBeLessThan(3000);
    expect(capture.snapshot()).toMatchObject({ state: 'incomplete', reason: 'flush_timeout' });
    const manifest = JSON.parse(await readFile(path.join(capture.directory!, 'manifest.json'), 'utf8'));
    expect(manifest.status).toBe('recording');
  });

  it('does not overwrite pre-existing or unsafe roots', async () => {
    const root = await temporaryRoot();
    const file = path.join(root, 'not-directory'); await writeFile(file, 'keep', { mode: 0o600 });
    await expect(createCaptureRecorder({ mode: 'protocol', rootDirectory: file, projectId: 'safe' })).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('keep');
    await chmod(root, 0o755);
    await expect(createCaptureRecorder({ mode: 'protocol', rootDirectory: root, projectId: 'safe' })).rejects.toThrow('private permissions');
    await chmod(root, 0o700);
  });
});
