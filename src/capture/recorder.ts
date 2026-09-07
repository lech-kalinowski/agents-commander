import { createHash, randomUUID, type Hash } from 'node:crypto';
import { lstat, mkdir, open, rename, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { assertPrivate, checkAncestors, makePrivateDirectory, openPrivateFile } from './files.js';
import { CaptureRedactor, MAX_CAPTURE_CONTENT_BYTES } from './redactor.js';
import { CAPTURE_LIMITS, MACHINE_RE, validateInput, validId } from './schema.js';
import type { CaptureActor, CaptureEvent, CaptureInput, CaptureManifest, CaptureRecorder, CaptureSegment, CaptureStatus, CreateCaptureOptions } from './types.js';

export const NOOP_CAPTURE: CaptureRecorder = Object.freeze({
  mode: 'off' as const,
  record() {}, bindCapability() { return ''; }, capabilityRef() { return undefined; },
  markIncomplete() {}, snapshot() { return { mode: 'off', state: 'off', events: 0, bytes: 0, pendingBytes: 0 } as CaptureStatus; },
  async close() {},
});

const CLOSE_TIMEOUT_MS = 2000;
const MAX_IDENTIFIERS = 20_000;
interface ActiveSegment { handle: FileHandle; file: string; bytes: number; events: number; hash: Hash }

class LocalCaptureRecorder implements CaptureRecorder {
  readonly mode: 'metadata' | 'protocol';
  readonly directory: string;
  private readonly captureId = randomUUID();
  private readonly startedAt = new Date().toISOString();
  private readonly started = performance.now();
  private readonly identifiers = new Map<string, string>();
  private readonly capabilityBySession = new Map<string, string>();
  private readonly keyReferences = new Map<string, string>();
  private readonly redactor: CaptureRedactor;
  private readonly segments: CaptureSegment[] = [];
  private state: CaptureStatus['state'] = 'recording';
  private reason?: string;
  private events = 0;
  private bytes = 0;
  private pendingBytes = 0;
  private queue: Buffer[] = [];
  private scheduled: NodeJS.Immediate | null = null;
  private drain: Promise<void> | null = null;
  private current: ActiveSegment | null = null;
  private closePromise: Promise<void> | null = null;
  private closing = false;
  private ioFailed = false;
  private timedOut = false;
  private readonly options: Readonly<Pick<CreateCaptureOptions, 'projectId' | 'synthetic' | 'onStatus'>>;

  constructor(options: CreateCaptureOptions, root: string) {
    this.options = { projectId: options.projectId, synthetic: options.synthetic === true, onStatus: options.onStatus };
    this.mode = options.mode as 'metadata' | 'protocol';
    this.directory = path.join(root, `capture-${this.captureId}`);
    this.redactor = new CaptureRedactor(options.knownSecrets);
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { mode: 0o700 });
    await this.writeManifest('recording', true);
    this.notify();
  }

  snapshot(): CaptureStatus {
    return { mode: this.mode, state: this.state, directory: this.directory, captureId: this.captureId,
      events: this.events, bytes: this.bytes, pendingBytes: this.pendingBytes, ...(this.reason ? { reason: this.reason } : {}) };
  }
  private notify(): void { try { this.options.onStatus?.(this.snapshot()); } catch { /* Observers never affect routing. */ } }
  markIncomplete(reason: string): void {
    if (this.state === 'complete') return;
    this.state = 'incomplete';
    this.reason ??= typeof reason === 'string' && MACHINE_RE.test(reason) ? reason : 'capture_failed';
    this.notify();
  }
  private identity(kind: string, raw: string): string {
    const key = `${kind}:${raw}`;
    const known = this.identifiers.get(key);
    if (known) return known;
    if (this.identifiers.size >= MAX_IDENTIFIERS) throw new Error('Identity dictionary full');
    const value = `${this.captureId}:${kind}_${this.identifiers.size + 1}`;
    this.identifiers.set(key, value);
    return value;
  }
  private actor(input: CaptureActor): CaptureActor {
    return { sessionId: this.identity('session', input.sessionId), panel: input.panel, agentType: input.agentType };
  }
  bindCapability(sessionId: string, key: string): string {
    try {
      if (this.state !== 'recording' || this.closing) return '';
      if (!validId(sessionId) || typeof key !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/u.test(key)) throw new Error('Invalid capability binding');
      let ref = this.keyReferences.get(key);
      if (!ref) {
        ref = `cap_${this.keyReferences.size + 1}`;
        this.redactor.addLiteral(key, `<cap:${ref}>`, 'capability');
        this.keyReferences.set(key, ref);
      }
      if (!this.capabilityBySession.has(sessionId) && this.capabilityBySession.size >= MAX_IDENTIFIERS) throw new Error('Session dictionary full');
      this.capabilityBySession.set(sessionId, ref);
      return ref;
    } catch { this.markIncomplete('capability_redaction_failed'); return ''; }
  }
  capabilityRef(sessionId: string): string | undefined { return this.capabilityBySession.get(sessionId); }

  record(input: CaptureInput): void {
    if (this.state !== 'recording' || this.closing) return;
    try {
      if (!validateInput(input)) { this.markIncomplete('invalid_event'); return; }
      const sequence = this.events + 1;
      const event: CaptureEvent = {
        schemaVersion: 1, captureId: this.captureId, eventId: `${this.captureId}:event_${sequence}`,
        sequence, at: new Date().toISOString(), elapsedMs: Math.max(0, performance.now() - this.started),
        type: input.type, redactions: {}, contentOmitted: false,
      };
      if (input.actor) event.actor = this.actor(input.actor);
      if (input.target) event.target = this.actor(input.target);
      for (const key of ['verb', 'capabilityRef', 'targetAgent', 'targetPanel', 'inputKind', 'outcome', 'reason', 'coverage'] as const) {
        if (input[key] !== undefined) Object.assign(event, { [key]: input[key] });
      }
      for (const [key, kind] of [['emissionId', 'emission'], ['messageId', 'message'], ['threadId', 'thread'], ['replyToMessageId', 'message']] as const) {
        if (input[key] !== undefined) event[key] = this.identity(kind, input[key]);
      }
      if (input.content !== undefined) {
        if (input.content.length > MAX_CAPTURE_CONTENT_BYTES || Buffer.byteLength(input.content) > MAX_CAPTURE_CONTENT_BYTES) {
          this.markIncomplete('content_limit'); return;
        }
        event.contentBytes = Buffer.byteLength(input.content);
        if (this.mode === 'metadata' || input.type === 'frame.rejected') event.contentOmitted = true;
        else Object.assign(event, this.redactor.redact(input.content));
      }
      const buffer = Buffer.from(`${JSON.stringify(event)}\n`);
      if (buffer.length > CAPTURE_LIMITS.eventBytes || this.bytes + buffer.length > CAPTURE_LIMITS.runBytes || sequence > CAPTURE_LIMITS.eventCount) {
        this.markIncomplete('capture_limit'); return;
      }
      if (this.pendingBytes + buffer.length > CAPTURE_LIMITS.pendingBytes) { this.markIncomplete('writer_backpressure'); return; }
      this.queue.push(buffer); this.pendingBytes += buffer.length;
      this.events = sequence; this.bytes += buffer.length;
      this.schedule(); this.notify();
    } catch { this.markIncomplete('sanitization_failed'); }
  }

  private schedule(): void {
    if (this.scheduled || this.drain || this.ioFailed) return;
    this.scheduled = setImmediate(() => { this.scheduled = null; void this.flush(); });
  }
  private flush(): Promise<void> {
    if (this.drain) return this.drain;
    this.drain = this.flushQueue().catch(() => {
      this.ioFailed = true; this.queue = []; this.pendingBytes = 0; this.markIncomplete('writer_failed');
    }).finally(() => {
      this.drain = null;
      if (this.queue.length && !this.ioFailed && !this.closing) this.schedule();
    });
    return this.drain;
  }
  private async flushQueue(): Promise<void> {
    while (this.queue.length && !this.ioFailed && !this.timedOut) {
      const buffer = this.queue[0];
      if (this.current && this.current.bytes + buffer.length > CAPTURE_LIMITS.segmentBytes) await this.sealSegment();
      if (!this.current) {
        const file = `events-${String(this.segments.length + 1).padStart(4, '0')}.jsonl`;
        const handle = await openPrivateFile(path.join(this.directory, file), true);
        this.current = { handle, file, bytes: 0, events: 0, hash: createHash('sha256') };
      }
      const current = this.current;
      let offset = 0;
      while (offset < buffer.length) {
        const result = await current.handle.write(buffer, offset, buffer.length - offset);
        if (result.bytesWritten === 0) throw new Error('Capture append failed');
        offset += result.bytesWritten;
      }
      if (this.timedOut) return;
      current.hash.update(buffer); current.bytes += buffer.length; current.events++;
      this.queue.shift(); this.pendingBytes -= buffer.length;
    }
  }
  private async sealSegment(): Promise<void> {
    const current = this.current;
    if (!current) return;
    await current.handle.sync();
    assertPrivate(await current.handle.stat(), false);
    await current.handle.close();
    this.current = null;
    this.segments.push({ file: current.file, bytes: current.bytes, events: current.events, sha256: current.hash.digest('hex') });
  }
  private manifest(status: CaptureManifest['status']): CaptureManifest {
    return { schemaVersion: 1, captureId: this.captureId, projectId: this.options.projectId, synthetic: this.options.synthetic === true,
      mode: this.mode, status, startedAt: this.startedAt, ...(status !== 'recording' ? { endedAt: new Date().toISOString() } : {}),
      ...(this.reason ? { reason: this.reason } : {}), redactionPolicy: 'commander-local-v1', limits: { ...CAPTURE_LIMITS },
      counts: { events: this.segments.reduce((n, segment) => n + segment.events, 0), bytes: this.segments.reduce((n, segment) => n + segment.bytes, 0) },
      segments: this.segments.map((segment) => ({ ...segment })) };
  }
  private async writeManifest(status: CaptureManifest['status'], initial = false): Promise<void> {
    const destination = path.join(this.directory, 'manifest.json');
    const temporary = initial ? destination : path.join(this.directory, `.manifest-${randomUUID()}.tmp`);
    const handle = await openPrivateFile(temporary, true);
    try { await handle.writeFile(`${JSON.stringify(this.manifest(status), null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    if (!initial) {
      if (this.timedOut) return; // Leave the initial recording manifest, never a false seal.
      await checkAncestors(this.directory);
      assertPrivate(await lstat(destination), false);
      await rename(temporary, destination);
    }
    // Segments and manifest bytes are already fsynced before the atomic rename.
    // A timeout during this final directory-sync acknowledgement conservatively
    // reports INCOMPLETE in memory, but the strict reader may still validate the
    // fully committed bytes. Missing or damaged crash-persisted files fail closed.
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  close(complete = true): Promise<void> {
    if (!complete) this.markIncomplete('session_incomplete');
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    if (this.scheduled) { clearImmediate(this.scheduled); this.scheduled = null; }
    this.closePromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.timedOut = true; this.queue = []; this.pendingBytes = 0;
        this.markIncomplete('flush_timeout'); resolve();
      }, CLOSE_TIMEOUT_MS);
      void (async () => {
        try {
          // An append can enter the queue after an existing flush loop exits
          // but before its promise's finally clears `drain`. Admission is now
          // sealed, so explicitly drain again rather than relying on schedule().
          do { await this.flush(); }
          while (this.queue.length > 0 && !this.ioFailed && !this.timedOut);
          if (this.ioFailed || this.timedOut) return;
          await this.sealSegment();
          if (this.timedOut) return;
          const committedEvents = this.segments.reduce((total, segment) => total + segment.events, 0);
          const committedBytes = this.segments.reduce((total, segment) => total + segment.bytes, 0);
          if (this.queue.length || this.pendingBytes || committedEvents !== this.events || committedBytes !== this.bytes) {
            this.markIncomplete('commit_count_mismatch');
          }
          const status = this.state === 'incomplete' ? 'incomplete' : 'complete';
          await this.writeManifest(status);
          if (!this.timedOut) this.state = status;
        } catch { this.markIncomplete('close_failed'); }
        finally {
          if (this.current) { try { await this.current.handle.close(); } catch {} this.current = null; }
          clearTimeout(timeout); this.notify(); resolve();
        }
      })();
    });
    return this.closePromise;
  }
}

export async function createCaptureRecorder(options: CreateCaptureOptions): Promise<CaptureRecorder> {
  if (options.mode === 'off') return NOOP_CAPTURE;
  if (options.mode !== 'metadata' && options.mode !== 'protocol') throw new Error('Unknown capture mode');
  if (typeof options.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(options.projectId)) {
    throw new Error('Capture requires an opaque project ID (1–64 letters, digits, hyphens or underscores)');
  }
  const root = options.rootDirectory ?? path.join(os.homedir(), '.agents-commander', 'captures');
  if (!path.isAbsolute(root) || path.resolve(root) !== root) throw new Error('Capture root must be an absolute normalized path');
  const recorder = new LocalCaptureRecorder(options, root);
  await makePrivateDirectory(root);
  await recorder.initialize();
  return recorder;
}
