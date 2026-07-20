import { describe, expect, it } from 'vitest';
import { MessageLedger } from '../../src/orchestration/message-ledger.js';

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
});
