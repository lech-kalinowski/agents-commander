import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import { HELP_TEXT } from '../../src/screen/dialog/help-dialog.js';
import { GUIDE_TEXT } from '../../src/screen/dialog/protocol-dialog.js';
import {
  COMPACT_WELCOME_TEXT,
  WELCOME_TEXT,
} from '../../src/screen/dialog/welcome-dialog.js';

function plain(text: string): string {
  return text.replace(/\{\/?[\w-]+\}/gu, '');
}

const help = plain(HELP_TEXT);
const guide = plain(GUIDE_TEXT);
const researchNames = [
  'commander-protocol-ai-research.md',
  'commander-protocol-commercial.md',
  'commander-protocol-uniqueness-and-originality.md',
];

describe('current-source protocol documentation', () => {
  it('uses the actual SEND/REPLY ACK format in guide examples', () => {
    // Exercise the production formatter without constructing UI or sessions.
    const formatter = Object.create(Orchestrator.prototype) as {
      sendAck: (
        source: number,
        target: string,
        panel: number,
        success: boolean,
        messageId: string,
        threadId: string,
        error?: string,
      ) => void;
      sendInfoToPanel: ReturnType<typeof vi.fn>;
    };
    formatter.sendInfoToPanel = vi.fn();
    formatter.sendAck(0, 'Codex CLI', 1, true, 'msg_000001', 'thr_000001');
    formatter.sendAck(0, 'Codex CLI', 1, false, 'msg_000001', 'thr_000001', 'reason');

    for (const [, ack] of formatter.sendInfoToPanel.mock.calls) {
      expect(guide).toContain(ack);
    }
    expect(guide).not.toContain('[Commander] Message delivered');
    expect(guide).not.toContain('[Commander] Failed to deliver');
  });

  it('documents resolved open reply windows and conditional failure restoration', () => {
    for (const copy of [help, guide]) {
      expect(copy).toContain('newest open window');
      expect(copy).toContain('both sessions remain active');
      expect(copy).not.toContain('Reply to last sender');
      expect(copy).not.toContain('whoever last messaged you');
    }
    expect(guide).toContain('A claimed window is consumed');
    expect(guide).toContain('No window means no route');
  });

  it('distinguishes delivery, broadcast admission, status acceptance and task completion', () => {
    expect(help).toContain('SEND/REPLY status=delivered confirms PTY input submission');
    expect(help).toContain('status=failed reports an error');
    expect(guide).toContain('PTY input submitted, not task completed');
    expect(guide).toContain('combined queue-admission ACK');
    expect(guide).toContain('[Commander ACK] kind=broadcast queued=1 targets=Codex CLI in Panel 2');
    expect(guide).toContain('[Commander ACK] kind=status status=accepted');
    expect(guide).toContain("QUERY agents only checks who's running");
    expect(guide).not.toContain("to check who's done");
  });

  it('does not advertise bounded diagnostics as durable capture', () => {
    for (const copy of [help, guide]) {
      expect(copy).toContain('rotating diagnostic log');
      expect(copy).toContain('Durable capture and dataset export are proposed, not implemented');
    }
    expect(guide).toContain('latest 100 routed-message summaries');
    expect(guide).toContain('1,000 records / 8 MiB');
    expect(guide).toContain('256 KiB per-record content');
    expect(guide).toContain('STATUS and QUERY are live-only');
    expect(guide).toContain('docs/session-capture-plan.md');
  });

  it('welcomes users to the paged multi-panel source workspace', () => {
    for (const copy of [WELCOME_TEXT, COMPACT_WELCOME_TEXT].map(plain)) {
      for (const adapter of ['Claude', 'Codex', 'Gemini', 'OpenCode', 'Shell']) {
        expect(copy).toContain(adapter);
      }
      expect(copy).toContain('100 active panels');
      expect(copy).toContain('auto-fit and paged views');
      expect(copy).toContain('Hidden terminal sessions keep running');
      expect(copy).not.toContain('dual-panel');
    }
  });

  it.each(researchNames)('scopes %s to source rather than an unexplained generation', (name) => {
    const content = readFileSync(new URL(`../../docs/${name}`, import.meta.url), 'utf8');
    expect(content).toContain('source `0.1.5`');
    expect(content).toContain('`001e903`');
    expect(content).not.toContain('`v11`');
    expect(content).toContain('(session-capture-plan.md)');
    expect(content).toContain('not implemented');
  });

  it('qualifies commercial applications with the repository license', () => {
    const content = readFileSync(
      new URL('../../docs/commander-protocol-commercial.md', import.meta.url),
      'utf8',
    );
    expect(content).toContain('[LICENSE](../LICENSE)');
    expect(content).toContain('CC-BY-NC-4.0');
    expect(content).toContain('explicit written permission from the author');
    expect(content).toContain('scenarios below do not grant that permission');
    expect(content).not.toContain('commercially viable for controlled internal use');
  });
});
