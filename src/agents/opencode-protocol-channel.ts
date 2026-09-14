import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { isProtocolCapability } from '../orchestration/protocol.js';

const MAX_WIRE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const ERROR_CODES = new Set(['session-mismatch', 'oversized-text', 'transport-failed', 'incomplete-frame']);

export interface OpenCodeCompletedText {
  sessionID: string;
  messageID: string;
  partID: string;
  text: string;
}

/** Launch-local configuration only: never write the user's OpenCode config. */
export function withOpenCodeProtocolPlugin(
  environment: Readonly<Record<string, string | undefined>>,
  pluginPath: string,
  token: string,
): Record<string, string | undefined> {
  let config: Record<string, unknown> = {};
  const inline = environment.OPENCODE_CONFIG_CONTENT;
  if (inline?.trim()) {
    try {
      const parsed: unknown = JSON.parse(inline);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      config = parsed as Record<string, unknown>;
    } catch {
      throw new Error('OpenCode inline configuration must be a JSON object to enable Commander transport');
    }
  }
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) {
    throw new Error('OpenCode inline plugin configuration must be an array');
  }
  const plugins = [...(config.plugin as unknown[] | undefined ?? [])];
  const pluginUrl = pathToFileURL(pluginPath).href;
  if (!plugins.includes(pluginUrl)) plugins.push(pluginUrl);
  return {
    ...environment,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, plugin: plugins }),
    AGENTS_COMMANDER_OPENCODE_TOKEN: token,
    AGENTS_COMMANDER_OPENCODE_FD: '4',
  };
}

/** Private per-child IPC. Contains no recorder, history reader, network or retry loop. */
export class OpenCodeProtocolChannel {
  readonly token = randomBytes(32).toString('base64url');
  private stream: Duplex | null = null;
  private pending = Buffer.alloc(0);
  private pendingBytes = 0;
  private epoch = 0;
  private capability: string | null = null;
  private sessionID: string | null = null;
  private hello = false;
  private armed = false;
  private epochFailed = false;
  private closed = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private issue: string | null = 'connecting';

  constructor(
    private onText: (event: OpenCodeCompletedText) => void,
    private onState: (issue: string | null) => void,
  ) {}

  get setupError(): string | null {
    if (this.closed) return 'OpenCode protocol transport is unavailable; restart this agent';
    if (!this.hello) return 'OpenCode protocol transport is connecting; wait for the agent to finish starting';
    return null;
  }

  get status(): string | null { return this.issue; }

  attach(stream: Duplex): void {
    if (this.stream || this.closed) throw new Error('OpenCode transport cannot be reused');
    this.stream = stream;
    stream.on('data', (chunk: Buffer) => this.receive(chunk));
    stream.on('error', () => this.fail('transport-failed'));
    stream.on('end', () => this.fail('transport-failed'));
    stream.on('close', () => this.fail('transport-failed'));
    this.startTimer = setTimeout(() => this.fail('transport-failed'), 30_000);
    this.startTimer.unref?.();
  }

  arm(capability: string): void {
    if (!isProtocolCapability(capability)) throw new Error('Invalid protocol capability');
    if (this.closed) return;
    this.capability = capability;
    this.epoch++;
    this.sessionID = null;
    this.armed = false;
    this.epochFailed = false;
    this.setIssue(this.hello ? 'waiting for protocol setup' : 'connecting');
    if (this.hello) this.sendArm();
  }

  private sendArm(): void {
    if (!this.stream || !this.capability || this.closed) return;
    this.stream.write(JSON.stringify({ v: 1, type: 'arm', token: this.token,
      capability: this.capability, epoch: this.epoch }) + '\n', (error) => {
      if (error) this.fail('transport-failed');
    });
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    // Bound wire bytes before decoding/allocating any complete JSON payload.
    if (this.pendingBytes + chunk.length > MAX_WIRE_BYTES) return this.fail('oversized-text');
    // Search each incoming byte once. Re-scanning/rebuilding an accumulated
    // string on every small PTY chunk stalls the UI on long simultaneous sends.
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const length = end - offset;
      const needed = this.pendingBytes + length;
      if (needed > this.pending.length) {
        let capacity = Math.max(8192, this.pending.length);
        while (capacity < needed) capacity *= 2;
        const expanded = Buffer.allocUnsafe(Math.min(capacity, MAX_WIRE_BYTES));
        this.pending.copy(expanded, 0, 0, this.pendingBytes);
        this.pending = expanded;
      }
      chunk.copy(this.pending, this.pendingBytes, offset, end);
      this.pendingBytes = needed;
      if (newline < 0) return;
      const line = this.pending.toString('utf8', 0, this.pendingBytes);
      this.pendingBytes = 0;
      if (this.pending.length > 65536) this.pending = Buffer.alloc(0);
      offset = newline + 1;
      if (!line) continue;
      let event: unknown;
      try { event = JSON.parse(line); } catch { return this.fail('transport-failed'); }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return this.fail('transport-failed');
      this.dispatch(event as Record<string, unknown>);
      if (this.closed) return;
    }
  }

  private dispatch(event: Record<string, unknown>): void {
    if (event.v !== 1 || event.token !== this.token) return this.fail('transport-failed');
    if (event.type === 'hello') {
      if (this.hello) return this.fail('transport-failed');
      this.hello = true;
      if (this.startTimer) clearTimeout(this.startTimer);
      this.startTimer = null;
      this.setIssue(this.capability ? 'waiting for protocol setup' : null);
      this.sendArm();
      return;
    }
    if (!this.hello) return this.fail('transport-failed');
    // Rotation invalidates already queued old-conversation output, not history.
    if (event.epoch !== this.epoch || event.capability !== this.capability || !this.capability) return;
    if (this.epochFailed) return;
    if (event.type === 'armed') { this.armed = true; return; }
    if (event.type === 'error') {
      const code = typeof event.code === 'string' && ERROR_CODES.has(event.code) ? event.code : 'transport-failed';
      if (code === 'session-mismatch') {
        this.sessionID = null;
        this.armed = false;
        this.epochFailed = true;
        this.setIssue('conversation changed — Ctrl+P required');
        return;
      }
      this.fail(code);
      return;
    }
    if (!this.armed) return;
    if (event.type === 'bound') {
      if (typeof event.sessionID !== 'string' || !ID.test(event.sessionID)) return this.fail('transport-failed');
      if (this.sessionID !== null && this.sessionID !== event.sessionID) return this.fail('session-mismatch');
      this.sessionID = event.sessionID;
      this.setIssue(null);
      return;
    }
    if (event.type !== 'text') return this.fail('transport-failed');
    if (!this.sessionID || event.sessionID !== this.sessionID) return;
    if (typeof event.messageID !== 'string' || !ID.test(event.messageID)
      || typeof event.partID !== 'string' || !ID.test(event.partID)
      || typeof event.text !== 'string') return this.fail('transport-failed');
    if (Buffer.byteLength(event.text, 'utf8') > MAX_TEXT_BYTES) return this.fail('oversized-text');
    this.onText({ sessionID: this.sessionID, messageID: event.messageID, partID: event.partID, text: event.text });
  }

  private setIssue(issue: string | null): void {
    if (this.issue === issue) return;
    this.issue = issue;
    this.onState(issue);
  }

  private fail(code: string): void {
    if (this.closed) return;
    this.setIssue(code === 'oversized-text' ? 'message exceeds transport limit' : 'transport unavailable — restart agent');
    this.dispose();
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.sessionID = null;
    this.capability = null;
    this.pending = Buffer.alloc(0);
    this.pendingBytes = 0;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.stream?.destroy();
    this.stream = null;
  }
}
