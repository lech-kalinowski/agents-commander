import { describe, expect, it } from 'vitest';
import {
  MESSAGE_LEDGER_MAX_RECORD_CONTENT_BYTES,
  MessageLedger,
} from '../../src/orchestration/message-ledger.js';

describe('MessageLedger', () => {
  it('creates queued messages with stable thread and message ids', () => {
    const ledger = new MessageLedger();
    const record = ledger.createMessage({
      kind: 'send',
      source: {
        sessionId: 'src-1',
        panelIndex: 0,
        agentName: 'Claude Code',
        agentType: 'claude',
      },
      target: {
        sessionId: 'dst-1',
        panelIndex: 1,
        agentName: 'Codex CLI',
        agentType: 'codex',
      },
      content: 'Review this change',
    });

    expect(record.messageId).toMatch(/^msg_/);
    expect(record.threadId).toMatch(/^thr_/);
    expect(record.status).toBe('queued');
  });

  it('claims and restores reply windows by waiting session', () => {
    const ledger = new MessageLedger();
    ledger.openReplyWindow({
      threadId: 'thr_1',
      replyToMessageId: 'msg_1',
      waitingOnSessionId: 'codex-1',
      returnToSessionId: 'claude-1',
      returnToAgentName: 'Claude Code',
      returnToAgentType: 'claude',
    });

    const claimed = ledger.claimReplyWindow('codex-1');
    expect(claimed).toMatchObject({
      threadId: 'thr_1',
      returnToSessionId: 'claude-1',
    });
    expect(ledger.claimReplyWindow('codex-1')).toBeNull();

    ledger.restoreReplyWindow(claimed!);
    expect(ledger.claimReplyWindow('codex-1')).toMatchObject({
      threadId: 'thr_1',
      replyToMessageId: 'msg_1',
    });
  });

  it('bounds reply windows per session while preserving newest-first claims', () => {
    const ledger = new MessageLedger(100, 1024, 1024, 2, 100);
    for (let index = 1; index <= 3; index += 1) {
      ledger.openReplyWindow({
        threadId: `thr_${index}`,
        replyToMessageId: `msg_${index}`,
        waitingOnSessionId: 'waiting-session',
        returnToSessionId: 'return-session',
        returnToAgentName: 'Claude Code',
        returnToAgentType: 'claude',
      });
    }

    expect(ledger.getPendingReplyCount()).toBe(2);
    expect(ledger.claimReplyWindow('waiting-session')?.threadId).toBe('thr_3');
    expect(ledger.claimReplyWindow('waiting-session')?.threadId).toBe('thr_2');
    expect(ledger.claimReplyWindow('waiting-session')).toBeNull();
  });

  it('bounds reply windows globally by evicting the oldest route', () => {
    const ledger = new MessageLedger(100, 1024, 1024, 10, 3);
    const open = (threadId: string, waitingOnSessionId: string) => {
      ledger.openReplyWindow({
        threadId,
        replyToMessageId: `msg_${threadId}`,
        waitingOnSessionId,
        returnToSessionId: 'return-session',
        returnToAgentName: 'Claude Code',
        returnToAgentType: 'claude',
      });
    };
    open('thr_1', 'waiting-a');
    open('thr_2', 'waiting-b');
    open('thr_3', 'waiting-a');
    open('thr_4', 'waiting-b');

    expect(ledger.getPendingReplyCount()).toBe(3);
    expect(ledger.claimReplyWindow('waiting-a')?.threadId).toBe('thr_3');
    expect(ledger.claimReplyWindow('waiting-a')).toBeNull();
    expect(ledger.claimReplyWindow('waiting-b')?.threadId).toBe('thr_4');
    expect(ledger.claimReplyWindow('waiting-b')?.threadId).toBe('thr_2');
  });

  it('restores a reply window once and makes it the newest route', () => {
    const ledger = new MessageLedger();
    const routeA = ledger.openReplyWindow({
      threadId: 'thr_a',
      replyToMessageId: 'msg_a',
      waitingOnSessionId: 'waiting-session',
      returnToSessionId: 'return-session',
      returnToAgentName: 'Claude Code',
      returnToAgentType: 'claude',
    });
    ledger.openReplyWindow({
      threadId: 'thr_b',
      replyToMessageId: 'msg_b',
      waitingOnSessionId: 'waiting-session',
      returnToSessionId: 'return-session',
      returnToAgentName: 'Claude Code',
      returnToAgentType: 'claude',
    });
    ledger.restoreReplyWindow(routeA);

    expect(ledger.getPendingReplyCount()).toBe(2);
    expect(ledger.claimReplyWindow('waiting-session')?.threadId).toBe('thr_a');
    expect(ledger.claimReplyWindow('waiting-session')?.threadId).toBe('thr_b');
    expect(ledger.claimReplyWindow('waiting-session')).toBeNull();
  });

  it('removes reply routes for closed sessions in either direction', () => {
    const ledger = new MessageLedger();
    const open = (
      threadId: string,
      waitingOnSessionId: string,
      returnToSessionId: string,
    ) => ledger.openReplyWindow({
      threadId,
      replyToMessageId: `msg_${threadId}`,
      waitingOnSessionId,
      returnToSessionId,
      returnToAgentName: 'Claude Code',
      returnToAgentType: 'claude',
    });
    open('thr_waiting', 'closing-session', 'return-a');
    open('thr_return', 'waiting-b', 'closing-session');
    open('thr_unrelated', 'waiting-c', 'return-c');

    ledger.closeSession('closing-session');

    expect(ledger.getPendingReplyCount()).toBe(1);
    expect(ledger.claimReplyWindow('closing-session')).toBeNull();
    expect(ledger.claimReplyWindow('waiting-b')).toBeNull();
    expect(ledger.claimReplyWindow('waiting-c')?.threadId).toBe('thr_unrelated');
  });

  it('removes thread metadata after its history and last reply route are evicted', () => {
    const ledger = new MessageLedger(1, 1024, 1024, 1, 10);
    const source = {
      sessionId: 'source-session',
      panelIndex: 0,
      agentName: 'Claude Code',
      agentType: 'claude' as const,
    };
    const target = {
      sessionId: 'waiting-session',
      panelIndex: 1,
      agentName: 'Codex CLI',
      agentType: 'codex' as const,
    };
    const first = ledger.createMessage({ kind: 'send', source, target, content: 'first' });
    ledger.markDelivered(first.messageId);
    ledger.openReplyWindow({
      threadId: first.threadId,
      replyToMessageId: first.messageId,
      waitingOnSessionId: target.sessionId,
      returnToSessionId: source.sessionId,
      returnToAgentName: source.agentName,
      returnToAgentType: source.agentType,
    });

    const second = ledger.createMessage({ kind: 'send', source, target, content: 'second' });
    ledger.markDelivered(second.messageId);
    expect(ledger.getMessage(first.messageId)).toBeNull();
    ledger.openReplyWindow({
      threadId: second.threadId,
      replyToMessageId: second.messageId,
      waitingOnSessionId: target.sessionId,
      returnToSessionId: source.sessionId,
      returnToAgentName: source.agentName,
      returnToAgentType: source.agentType,
    });

    const internals = ledger as unknown as { threads: Map<string, unknown> };
    expect(internals.threads.has(first.threadId)).toBe(false);
    expect(internals.threads.has(second.threadId)).toBe(true);
  });

  it('keeps route and thread metadata bounded under sustained traffic', () => {
    const ledger = new MessageLedger(5, 1024, 1024, 3, 7);
    const source = {
      sessionId: 'source-session',
      panelIndex: 0,
      agentName: 'Claude Code',
      agentType: 'claude' as const,
    };

    for (let index = 0; index < 100; index += 1) {
      const waitingOnSessionId = `waiting-${index % 4}`;
      const record = ledger.createMessage({
        kind: 'send',
        source,
        target: {
          sessionId: waitingOnSessionId,
          panelIndex: (index % 4) + 1,
          agentName: 'Codex CLI',
          agentType: 'codex',
        },
        content: `message-${index}`,
      });
      ledger.markDelivered(record.messageId);
      ledger.openReplyWindow({
        threadId: record.threadId,
        replyToMessageId: record.messageId,
        waitingOnSessionId,
        returnToSessionId: source.sessionId,
        returnToAgentName: source.agentName,
        returnToAgentType: source.agentType,
      });
    }

    const internals = ledger as unknown as {
      messages: Map<string, unknown>;
      threads: Map<string, unknown>;
    };
    expect(ledger.getPendingReplyCount()).toBe(7);
    expect(internals.threads.size).toBeLessThanOrEqual(internals.messages.size + 7);
  });

  it('marks messages as delivered or failed', () => {
    const ledger = new MessageLedger();
    const record = ledger.createMessage({
      kind: 'reply',
      source: {
        sessionId: 'src-1',
        panelIndex: 0,
        agentName: 'Codex CLI',
        agentType: 'codex',
      },
      target: {
        sessionId: null,
        panelIndex: 1,
        agentName: 'Claude Code',
        agentType: 'claude',
      },
      content: 'Done',
      threadId: 'thr_custom',
      replyToMessageId: 'msg_prev',
    });

    ledger.markDelivered(record.messageId, {
      sessionId: 'claude-1',
      panelIndex: 1,
      agentName: 'Claude Code',
      agentType: 'claude',
    });
    expect(ledger.getMessage(record.messageId)?.status).toBe('delivered');

    ledger.markFailed(record.messageId, 'transport closed');
    expect(ledger.getMessage(record.messageId)).toMatchObject({
      status: 'failed',
      error: 'transport closed',
    });
  });

  it('bounds completed history while retaining queued messages', () => {
    const ledger = new MessageLedger(2);
    const source = {
      sessionId: 'src-1',
      panelIndex: 0,
      agentName: 'Codex CLI',
      agentType: 'codex' as const,
    };
    const target = {
      sessionId: 'dst-1',
      panelIndex: 1,
      agentName: 'Claude Code',
      agentType: 'claude' as const,
    };

    const oldest = ledger.createMessage({ kind: 'send', source, target, content: 'one' });
    ledger.markDelivered(oldest.messageId);
    const middle = ledger.createMessage({ kind: 'send', source, target, content: 'two' });
    ledger.markDelivered(middle.messageId);
    const queued = ledger.createMessage({ kind: 'send', source, target, content: 'three' });

    expect(ledger.getMessage(oldest.messageId)).toBeNull();
    expect(ledger.getRecentMessages()).toEqual([queued, middle]);
  });

  it('returns deep defensive snapshots of recent messages', () => {
    const ledger = new MessageLedger();
    ledger.createMessage({
      kind: 'send',
      source: {
        sessionId: 'source-session',
        panelIndex: 0,
        agentName: 'Claude Code',
        agentType: 'claude',
      },
      target: {
        sessionId: 'target-session',
        panelIndex: 1,
        agentName: 'Codex CLI',
        agentType: 'codex',
      },
      content: 'Review this change',
    });

    const firstSnapshot = ledger.getRecentMessages()[0];
    firstSnapshot.content = 'mutated content';
    firstSnapshot.source.agentName = 'mutated source';
    firstSnapshot.target.agentName = 'mutated target';

    expect(ledger.getRecentMessages()[0]).toMatchObject({
      content: 'Review this change',
      source: { agentName: 'Claude Code' },
      target: { agentName: 'Codex CLI' },
    });
  });

  it('bounds individual retained payloads without splitting UTF-8 output', () => {
    const ledger = new MessageLedger();
    const record = ledger.createMessage({
      kind: 'send',
      source: {
        sessionId: 'source-session',
        panelIndex: 0,
        agentName: 'Claude Code',
        agentType: 'claude',
      },
      target: {
        sessionId: 'target-session',
        panelIndex: 1,
        agentName: 'Codex CLI',
        agentType: 'codex',
      },
      content: '🧪'.repeat(MESSAGE_LEDGER_MAX_RECORD_CONTENT_BYTES),
    });

    expect(Buffer.byteLength(record.content, 'utf8')).toBeLessThanOrEqual(
      MESSAGE_LEDGER_MAX_RECORD_CONTENT_BYTES,
    );
    expect(record.content).toContain('[Commander: message content truncated]');
    expect(record.content).not.toContain('�');
    expect(ledger.getRetainedContentBytes()).toBe(Buffer.byteLength(record.content, 'utf8'));
  });

  it('evicts completed history to stay within its retained-content budget', () => {
    const ledger = new MessageLedger(100, 20, 20);
    const source = {
      sessionId: 'source-session',
      panelIndex: 0,
      agentName: 'Claude Code',
      agentType: 'claude' as const,
    };
    const target = {
      sessionId: 'target-session',
      panelIndex: 1,
      agentName: 'Codex CLI',
      agentType: 'codex' as const,
    };

    for (const content of ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd']) {
      const record = ledger.createMessage({ kind: 'send', source, target, content });
      ledger.markFailed(record.messageId, 'capacity rejection');
    }

    const retained = ledger.getRecentMessages(100);
    expect(ledger.getRetainedContentBytes()).toBeLessThanOrEqual(20);
    expect(retained.map((record) => record.content)).toEqual(['dddddddddd', 'cccccccccc']);
    expect(retained.every((record) => record.status === 'failed')).toBe(true);
  });

  it('may evict protected history payloads without losing pending reply routes', () => {
    const ledger = new MessageLedger(100, 12, 12);
    const source = {
      sessionId: 'source-session',
      panelIndex: 0,
      agentName: 'Claude Code',
      agentType: 'claude' as const,
    };
    const target = {
      sessionId: 'target-session',
      panelIndex: 1,
      agentName: 'Codex CLI',
      agentType: 'codex' as const,
    };
    const first = ledger.createMessage({ kind: 'send', source, target, content: 'first-six' });
    ledger.markDelivered(first.messageId);
    ledger.openReplyWindow({
      threadId: first.threadId,
      replyToMessageId: first.messageId,
      waitingOnSessionId: target.sessionId,
      returnToSessionId: source.sessionId,
      returnToAgentName: source.agentName,
      returnToAgentType: source.agentType,
    });
    const second = ledger.createMessage({ kind: 'send', source, target, content: 'second-six' });
    ledger.markDelivered(second.messageId);
    ledger.openReplyWindow({
      threadId: second.threadId,
      replyToMessageId: second.messageId,
      waitingOnSessionId: target.sessionId,
      returnToSessionId: source.sessionId,
      returnToAgentName: source.agentName,
      returnToAgentType: source.agentType,
    });

    expect(ledger.getRetainedContentBytes()).toBeLessThanOrEqual(12);
    expect(ledger.getMessage(first.messageId)).toBeNull();
    expect(ledger.claimReplyWindow(target.sessionId)?.threadId).toBe(second.threadId);
    expect(ledger.claimReplyWindow(target.sessionId)?.threadId).toBe(first.threadId);
  });
});
