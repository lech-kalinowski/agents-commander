import { describe, expect, it } from 'vitest';
import type { ProtocolIssue } from '../../src/orchestration/protocol.js';
import {
  buildProtocolFeedback,
  MAX_PROTOCOL_CORRECTIONS,
  ProtocolFeedbackBudget,
} from '../../src/orchestration/protocol-feedback.js';

const capability = 'synthetic_private_capability_'.padEnd(43, 'x');
const fingerprint = 'synthetic-private-fingerprint';

function issue(code: ProtocolIssue['code'], sequences: number[] = [1]): ProtocolIssue {
  return { code, capability, sequences, fingerprint };
}

describe('fixed protocol-correction feedback', () => {
  it.each([
    ['missing-header-delimiter', 'Missing closing === on the header.'],
    ['missing-footer-delimiter', 'Missing closing === on the END footer.'],
    ['missing-both-delimiters', 'Missing closing === on both the header and END footer.'],
    ['mismatched-sequence', 'must use exactly the same counter'],
    ['invalid-sequence', 'no leading zero, sign, fraction, or placeholder'],
    ['invalid-panel', 'valid stable P number from the current roster'],
    ['invalid-header', 'complete SEND, REPLY, BROADCAST, STATUS, or QUERY header'],
    ['oversized-frame', 'split it into separate complete frames, each with a fresh counter'],
    ['missing-footer', 'entire corrected frame within one completed text part'],
  ] as const)('explains %s without revealing authored data', (code, expected) => {
    const text = buildProtocolFeedback(issue(code), 1);
    expect(text).toContain('[Commander protocol error] This frame was not sent.');
    expect(text).toContain(expected);
    expect(text).toContain('fresh counter');
    expect(text).toContain('matching END footer');
    expect(text).toContain('Correction notice 1 of 3.');
    expect(text).not.toContain(capability);
    expect(text).not.toContain(fingerprint);
    expect(text).not.toContain('===COMMANDER:');
    expect(text.length).toBeLessThan(1024);
    // Keep even the largest final notice inside the single-chunk input path.
    // This avoids a pacing delay with an unfinished bracketed paste.
    const largestNotice = buildProtocolFeedback(issue(code,
      Array.from({ length: 8 }, (_, index) => Number.MAX_SAFE_INTEGER - index)), MAX_PROTOCOL_CORRECTIONS);
    expect(Buffer.byteLength(largestNotice, 'utf8')).toBeLessThan(1024);
  });

  it('identifies only the rejected frame and does not invite replay of valid neighboring frames', () => {
    const text = buildProtocolFeedback(issue('missing-header-delimiter'), 1);
    expect(text).toContain('This frame was not sent.');
    expect(text).toContain('Do not resend other frames already acknowledged as delivered.');
    expect(text).toContain('Keep the intended recipient and task unchanged.');
    expect(text).not.toMatch(/(?:whole|entire) (?:part|response|message)/i);
  });

  it('includes only positive safe-integer rejected counters and removes duplicates', () => {
    const text = buildProtocolFeedback(issue('mismatched-sequence', [5, 5, 6, 0, -1, 1.5, NaN, Infinity]), 1);
    expect(text).toContain('Rejected counters: 5, 6.');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Infinity');
  });

  it('does not include an optional rejected-counter field when no canonical counter is available', () => {
    expect(buildProtocolFeedback(issue('invalid-sequence', []), 1)).not.toContain('Rejected counters:');
    expect(buildProtocolFeedback(issue('invalid-sequence', [Number.MAX_SAFE_INTEGER + 1]), 1))
      .not.toContain('Rejected counters:');
  });

  it('bounds counter-display metadata without changing or consuming the supplied issue', () => {
    const original = issue('mismatched-sequence', Array.from({ length: 1000 }, (_, index) => index + 1));
    const text = buildProtocolFeedback(original, 2);
    expect(text).toContain('Rejected counters: 1, 2, 3, 4, 5, 6, 7, 8.');
    expect(text).not.toContain(', 9');
    expect(original.sequences).toHaveLength(1000);
  });

  it('ignores runtime extra payload fields and does not serialize issue objects', () => {
    const untrusted = {
      ...issue('missing-both-delimiters'),
      body: 'private model output',
      content: '\x1b[31mprivate terminal content',
      proposedRepair: '===COMMANDER:SEND:codex:2:secret:1===',
    };
    const text = buildProtocolFeedback(untrusted, 1);
    expect(text).not.toContain('private model output');
    expect(text).not.toContain('private terminal content');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('\x1b');
  });

  it.each(['forged diagnostic with private content', '__proto__', 'constructor'])
    ('uses a fixed safe fallback for an unexpected runtime code %s', (code) => {
      const text = buildProtocolFeedback({ ...issue('invalid-header'), code } as ProtocolIssue, 1);
      expect(text).toContain('Use a complete SEND, REPLY, BROADCAST, STATUS, or QUERY header');
      expect(text).not.toContain(code);
    });

  it('does not interpolate nonnumeric runtime counter values', () => {
    const malformed = { ...issue('invalid-sequence'), sequences: ['private token', { body: 'private text' }, 2] };
    const text = buildProtocolFeedback(malformed as unknown as ProtocolIssue, 1);
    expect(text).toContain('Rejected counters: 2.');
    expect(text).not.toContain('private');
    expect(text).not.toContain('[object Object]');
  });

  it('warns at the third notice to stop if the next correction fails', () => {
    for (const attempt of [1, 2]) {
      expect(buildProtocolFeedback(issue('missing-header-delimiter'), attempt)).not.toContain('stop and ask the user');
    }
    const finalNotice = buildProtocolFeedback(issue('missing-header-delimiter'), MAX_PROTOCOL_CORRECTIONS);
    expect(finalNotice).toContain('Correction notice 3 of 3.');
    expect(finalNotice).toContain('If your next correction fails, stop and ask the user.');
    expect(finalNotice).toContain('paused until the user reinjects protocol instructions');
  });

  it.each([0, -1, 1.5, 4, NaN, Infinity])('refuses an invalid notice attempt %s', (attempt) => {
    expect(() => buildProtocolFeedback(issue('invalid-header'), attempt)).toThrow(RangeError);
  });
});

describe('per-capability correction feedback budget', () => {
  it('grants exactly three notices and remains exhausted without automatic resets', () => {
    const budget = new ProtocolFeedbackBudget();
    expect(MAX_PROTOCOL_CORRECTIONS).toBe(3);
    expect([budget.claim(), budget.claim(), budget.claim()]).toEqual([1, 2, 3]);
    for (let index = 0; index < 1000; index++) expect(budget.claim()).toBeNull();
  });

  it('starts a fresh bounded allowance only when its owner explicitly resets it', () => {
    const budget = new ProtocolFeedbackBudget();
    expect([budget.claim(), budget.claim(), budget.claim(), budget.claim()]).toEqual([1, 2, 3, null]);
    budget.reset();
    expect([budget.claim(), budget.claim(), budget.claim(), budget.claim()]).toEqual([1, 2, 3, null]);
  });

  it('keeps different armed sessions independent', () => {
    const first = new ProtocolFeedbackBudget();
    const second = new ProtocolFeedbackBudget();
    expect([first.claim(), first.claim(), first.claim(), first.claim()]).toEqual([1, 2, 3, null]);
    expect(second.claim()).toBe(1);
    second.reset();
    expect(first.claim()).toBeNull();
    expect(second.claim()).toBe(1);
  });
});
