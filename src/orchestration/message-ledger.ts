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

export class MessageLedger {
  private nextMessageSeq = 1;
  private nextThreadSeq = 1;
  private messages = new Map<string, MessageRecord>();
  private threads = new Map<string, ThreadRecord>();
  private pendingReplies = new Map<string, PendingReplyRoute[]>();

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

    const record: MessageRecord = {
      messageId,
      threadId,
      kind: input.kind,
      source: input.source,
      target: input.target,
      content: input.content,
      createdAt,
      updatedAt: createdAt,
      status: 'queued',
      replyToMessageId: input.replyToMessageId ?? null,
    };

    this.messages.set(messageId, record);
    const thread = this.ensureThread(threadId, createdAt);
    thread.lastMessageId = messageId;
    thread.updatedAt = createdAt;
    thread.participants.add(input.source.sessionId);
    if (input.target.sessionId) {
      thread.participants.add(input.target.sessionId);
    }

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
    const route: PendingReplyRoute = {
      ...params,
      updatedAt: Date.now(),
    };

    const queue = this.pendingReplies.get(params.waitingOnSessionId) ?? [];
    const deduped = queue.filter((entry) => entry.threadId !== route.threadId);
    deduped.push(route);
    this.pendingReplies.set(params.waitingOnSessionId, deduped);
    return route;
  }

  claimReplyWindow(sessionId: string): PendingReplyRoute | null {
    const queue = this.pendingReplies.get(sessionId);
    if (!queue || queue.length === 0) return null;
    const route = queue.pop() ?? null;
    if (!route) return null;
    if (queue.length === 0) {
      this.pendingReplies.delete(sessionId);
    } else {
      this.pendingReplies.set(sessionId, queue);
    }
    return route;
  }

  restoreReplyWindow(route: PendingReplyRoute): void {
    const queue = this.pendingReplies.get(route.waitingOnSessionId) ?? [];
    const deduped = queue.filter((entry) => entry.threadId !== route.threadId);
    deduped.push({ ...route, updatedAt: Date.now() });
    this.pendingReplies.set(route.waitingOnSessionId, deduped);
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
  }

  getMessage(messageId: string): MessageRecord | null {
    return this.messages.get(messageId) ?? null;
  }

  getRecentMessages(limit = 50): MessageRecord[] {
    return [...this.messages.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
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
}
