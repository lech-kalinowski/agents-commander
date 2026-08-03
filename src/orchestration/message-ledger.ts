import type { AgentType } from '../agents/types.js';
import type { MessageType } from './protocol.js';

export type DeliveryStatus = 'queued' | 'delivered' | 'failed' | 'timed_out' | 'dropped';

export interface SessionRef {
  sessionId: string;
  panelIndex: number;
  agentName: string;
  agentType: AgentType;
}

export interface MessageTargetRef {
  sessionId: string | null;
  panelIndex: number | null;
  agentName: string | null;
  agentType: AgentType;
}

export interface MessageRecord {
  messageId: string;
  threadId: string;
  kind: MessageType;
  source: SessionRef;
  target: MessageTargetRef;
  content: string;
  createdAt: number;
  updatedAt: number;
  status: DeliveryStatus;
  replyToMessageId: string | null;
  error?: string;
}

export interface PendingReplyRoute {
  threadId: string;
  replyToMessageId: string;
  waitingOnSessionId: string;
  returnToSessionId: string;
  returnToAgentName: string;
  returnToAgentType: AgentType;
  updatedAt: number;
}

interface ThreadRecord {
  threadId: string;
  createdAt: number;
  updatedAt: number;
  lastMessageId: string;
  participants: Set<string>;
}

interface StoredPendingReplyRoute extends PendingReplyRoute {
  order: number;
}

export const MESSAGE_LEDGER_MAX_CONTENT_BYTES = 8 * 1024 * 1024;
export const MESSAGE_LEDGER_MAX_RECORD_CONTENT_BYTES = 256 * 1024;
export const MESSAGE_LEDGER_MAX_PENDING_REPLIES_PER_SESSION = 64;
export const MESSAGE_LEDGER_MAX_PENDING_REPLIES_GLOBAL = 1000;
const CONTENT_TRUNCATION_MARKER = '\n[Commander: message content truncated]';

export class MessageLedger {
  private nextMessageSeq = 1;
  private nextThreadSeq = 1;
  private nextPendingReplySeq = 1;
  private messages = new Map<string, MessageRecord>();
  private threads = new Map<string, ThreadRecord>();
  private pendingReplies = new Map<string, StoredPendingReplyRoute[]>();
  private retainedContentBytes = 0;
  private contentBytesByMessage = new Map<string, number>();

  constructor(
    private readonly maxMessages = 1000,
    private readonly maxContentBytes = MESSAGE_LEDGER_MAX_CONTENT_BYTES,
    private readonly maxRecordContentBytes = MESSAGE_LEDGER_MAX_RECORD_CONTENT_BYTES,
    private readonly maxPendingRepliesPerSession = MESSAGE_LEDGER_MAX_PENDING_REPLIES_PER_SESSION,
    private readonly maxPendingRepliesGlobal = MESSAGE_LEDGER_MAX_PENDING_REPLIES_GLOBAL,
  ) {}

  createMessage(input: {
    kind: MessageType;
    source: SessionRef;
    target: MessageTargetRef;
    content: string;
    threadId?: string;
    replyToMessageId?: string | null;
  }): MessageRecord {
    const createdAt = Date.now();
    const threadId = input.threadId ?? this.makeThreadId();
    const messageId = this.makeMessageId();

    const content = this.boundContent(input.content);
    const record: MessageRecord = {
      messageId,
      threadId,
      kind: input.kind,
      source: input.source,
      target: input.target,
      content,
      createdAt,
      updatedAt: createdAt,
      status: 'queued',
      replyToMessageId: input.replyToMessageId ?? null,
    };

    this.messages.set(messageId, record);
    const contentBytes = Buffer.byteLength(content, 'utf8');
    this.contentBytesByMessage.set(messageId, contentBytes);
    this.retainedContentBytes += contentBytes;
    const thread = this.ensureThread(threadId, createdAt);
    thread.lastMessageId = messageId;
    thread.updatedAt = createdAt;
    thread.participants.add(input.source.sessionId);
    if (input.target.sessionId) {
      thread.participants.add(input.target.sessionId);
    }

    this.pruneHistory();

    return record;
  }

  markDelivered(messageId: string, target?: SessionRef): MessageRecord | null {
    const record = this.messages.get(messageId);
    if (!record) return null;

    if (target) {
      record.target = {
        sessionId: target.sessionId,
        panelIndex: target.panelIndex,
        agentName: target.agentName,
        agentType: target.agentType,
      };
    }

    record.status = 'delivered';
    record.updatedAt = Date.now();
    const thread = this.threads.get(record.threadId);
    if (thread) {
      thread.lastMessageId = record.messageId;
      thread.updatedAt = record.updatedAt;
      if (record.target.sessionId) {
        thread.participants.add(record.target.sessionId);
      }
    }
    this.pruneHistory();
    return record;
  }

  markFailed(messageId: string, error: string, status: DeliveryStatus = 'failed'): MessageRecord | null {
    const record = this.messages.get(messageId);
    if (!record) return null;
    record.status = status;
    record.error = error;
    record.updatedAt = Date.now();
    const thread = this.threads.get(record.threadId);
    if (thread) {
      thread.updatedAt = record.updatedAt;
    }
    this.pruneHistory();
    return record;
  }

  openReplyWindow(params: {
    threadId: string;
    replyToMessageId: string;
    waitingOnSessionId: string;
    returnToSessionId: string;
    returnToAgentName: string;
    returnToAgentType: AgentType;
  }): PendingReplyRoute {
    const route = this.retainReplyWindow({
      ...params,
      updatedAt: Date.now(),
    });
    return this.snapshotReplyRoute(route);
  }

  claimReplyWindow(sessionId: string): PendingReplyRoute | null {
    const queue = this.pendingReplies.get(sessionId);
    if (!queue || queue.length === 0) return null;
    const route = queue.pop();
    if (!route) return null;
    if (queue.length === 0) {
      this.pendingReplies.delete(sessionId);
    } else {
      this.pendingReplies.set(sessionId, queue);
    }
    this.pruneOrphanedThreads();
    return this.snapshotReplyRoute(route);
  }

  restoreReplyWindow(route: PendingReplyRoute): void {
    this.retainReplyWindow({ ...route, updatedAt: Date.now() });
  }

  closeSession(sessionId: string): void {
    this.pendingReplies.delete(sessionId);
    for (const [waitingOnSessionId, queue] of this.pendingReplies) {
      const nextQueue = queue.filter((route) => route.returnToSessionId !== sessionId);
      if (nextQueue.length === 0) {
        this.pendingReplies.delete(waitingOnSessionId);
      } else if (nextQueue.length !== queue.length) {
        this.pendingReplies.set(waitingOnSessionId, nextQueue);
      }
    }
    this.pruneOrphanedThreads();
  }

  getMessage(messageId: string): MessageRecord | null {
    return this.messages.get(messageId) ?? null;
  }

  getRecentMessages(limit = 50): MessageRecord[] {
    const count = Math.max(0, Math.trunc(limit));
    if (count === 0) return [];
    return [...this.messages.values()]
      .slice(-count)
      .reverse()
      .map((record) => this.snapshotMessage(record));
  }

  getRetainedContentBytes(): number {
    return this.retainedContentBytes;
  }

  getPendingReplyCount(): number {
    let count = 0;
    for (const queue of this.pendingReplies.values()) count += queue.length;
    return count;
  }

  private pruneHistory(): void {
    const isWithinBudget = () => (
      this.messages.size <= this.maxMessages
      && this.retainedContentBytes <= this.maxContentBytes
    );
    if (isWithinBudget()) return;

    const protectedMessageIds = new Set<string>();
    for (const queue of this.pendingReplies.values()) {
      for (const route of queue) {
        protectedMessageIds.add(route.replyToMessageId);
      }
    }

    const pruneCompleted = (includeReplyProtected: boolean) => {
      for (const [messageId, record] of this.messages) {
        if (isWithinBudget()) break;
        if (record.status === 'queued') continue;
        if (!includeReplyProtected && protectedMessageIds.has(messageId)) continue;
        this.deleteMessage(messageId);
      }
    };
    pruneCompleted(false);
    // Pending reply routes already retain the thread/message identifiers they
    // need, so their historical payload may be evicted under byte pressure.
    pruneCompleted(true);

    this.pruneOrphanedThreads();
  }

  private retainReplyWindow(route: PendingReplyRoute): StoredPendingReplyRoute {
    const stored: StoredPendingReplyRoute = {
      ...route,
      order: this.nextPendingReplySeq++,
    };
    const queue = this.pendingReplies.get(route.waitingOnSessionId) ?? [];
    const deduped = queue.filter((entry) => entry.threadId !== route.threadId);
    deduped.push(stored);

    const perSessionLimit = this.normaliseLimit(this.maxPendingRepliesPerSession);
    if (deduped.length > perSessionLimit) {
      deduped.splice(0, deduped.length - perSessionLimit);
    }
    if (deduped.length === 0) {
      this.pendingReplies.delete(route.waitingOnSessionId);
    } else {
      this.pendingReplies.set(route.waitingOnSessionId, deduped);
    }

    this.prunePendingRepliesToGlobalLimit();
    this.pruneOrphanedThreads();
    return stored;
  }

  private prunePendingRepliesToGlobalLimit(): void {
    const globalLimit = this.normaliseLimit(this.maxPendingRepliesGlobal);
    while (this.getPendingReplyCount() > globalLimit) {
      let oldestSessionId: string | null = null;
      let oldestOrder = Number.POSITIVE_INFINITY;
      for (const [sessionId, queue] of this.pendingReplies) {
        const candidate = queue[0];
        if (candidate && candidate.order < oldestOrder) {
          oldestOrder = candidate.order;
          oldestSessionId = sessionId;
        }
      }
      if (oldestSessionId === null) break;

      const queue = this.pendingReplies.get(oldestSessionId);
      queue?.shift();
      if (!queue || queue.length === 0) this.pendingReplies.delete(oldestSessionId);
    }
  }

  private pruneOrphanedThreads(): void {
    const referencedThreadIds = new Set<string>();
    for (const record of this.messages.values()) referencedThreadIds.add(record.threadId);
    for (const queue of this.pendingReplies.values()) {
      for (const route of queue) referencedThreadIds.add(route.threadId);
    }
    for (const threadId of this.threads.keys()) {
      if (!referencedThreadIds.has(threadId)) this.threads.delete(threadId);
    }
  }

  private normaliseLimit(limit: number): number {
    if (!Number.isFinite(limit)) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.trunc(limit));
  }

  private deleteMessage(messageId: string): void {
    if (!this.messages.delete(messageId)) return;
    const contentBytes = this.contentBytesByMessage.get(messageId) ?? 0;
    this.contentBytesByMessage.delete(messageId);
    this.retainedContentBytes = Math.max(0, this.retainedContentBytes - contentBytes);
  }

  private boundContent(content: string): string {
    const byteLimit = Math.max(
      0,
      Math.min(this.maxContentBytes, this.maxRecordContentBytes),
    );
    if (Buffer.byteLength(content, 'utf8') <= byteLimit) return content;
    const markerBytes = Buffer.byteLength(CONTENT_TRUNCATION_MARKER, 'utf8');
    if (byteLimit <= markerBytes) return this.truncateUtf8(content, byteLimit);
    return this.truncateUtf8(content, byteLimit - markerBytes) + CONTENT_TRUNCATION_MARKER;
  }

  private truncateUtf8(content: string, maxBytes: number): string {
    if (maxBytes <= 0) return '';
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length <= maxBytes) return content;
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
    return bytes.subarray(0, end).toString('utf8');
  }

  private ensureThread(threadId: string, createdAt: number): ThreadRecord {
    const existing = this.threads.get(threadId);
    if (existing) return existing;

    const thread: ThreadRecord = {
      threadId,
      createdAt,
      updatedAt: createdAt,
      lastMessageId: '',
      participants: new Set<string>(),
    };
    this.threads.set(threadId, thread);
    return thread;
  }

  private makeMessageId(): string {
    const id = this.nextMessageSeq++;
    return `msg_${id.toString(36).padStart(6, '0')}`;
  }

  private makeThreadId(): string {
    const id = this.nextThreadSeq++;
    return `thr_${id.toString(36).padStart(6, '0')}`;
  }

  private snapshotMessage(record: MessageRecord): MessageRecord {
    return {
      messageId: record.messageId,
      threadId: record.threadId,
      kind: record.kind,
      source: {
        sessionId: record.source.sessionId,
        panelIndex: record.source.panelIndex,
        agentName: record.source.agentName,
        agentType: record.source.agentType,
      },
      target: {
        sessionId: record.target.sessionId,
        panelIndex: record.target.panelIndex,
        agentName: record.target.agentName,
        agentType: record.target.agentType,
      },
      content: record.content,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      status: record.status,
      replyToMessageId: record.replyToMessageId,
      ...(record.error === undefined ? {} : { error: record.error }),
    };
  }

  private snapshotReplyRoute(route: PendingReplyRoute): PendingReplyRoute {
    return {
      threadId: route.threadId,
      replyToMessageId: route.replyToMessageId,
      waitingOnSessionId: route.waitingOnSessionId,
      returnToSessionId: route.returnToSessionId,
      returnToAgentName: route.returnToAgentName,
      returnToAgentType: route.returnToAgentType,
      updatedAt: route.updatedAt,
    };
  }
}
