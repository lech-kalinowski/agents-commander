import type { ProtocolIssue } from './protocol.js';

/** Automatic correction notices per explicit protocol-capability arm. */
export const MAX_PROTOCOL_CORRECTIONS = 3;

const ISSUE_EXPLANATIONS: Record<ProtocolIssue['code'], string> = {
  'missing-header-delimiter': 'Missing closing === on the header.',
  'missing-footer-delimiter': 'Missing closing === on the END footer.',
  'missing-both-delimiters': 'Missing closing === on both the header and END footer.',
  'mismatched-sequence': 'The header and END footer must use exactly the same counter.',
  'invalid-sequence': 'Use a positive safe-integer counter written as canonical decimal digits: no leading zero, sign, fraction, or placeholder.',
  'invalid-panel': 'SEND requires the intended recipient\'s valid stable P number from the current roster. Do not guess a panel or redirect the message.',
  'invalid-header': 'Use a complete SEND, REPLY, BROADCAST, STATUS, or QUERY header with the required fields and delimiters.',
  'oversized-frame': 'The frame exceeds the message size limit. Shorten it or split it into separate complete frames, each with a fresh counter.',
  'missing-footer': 'The completed text part has no matching END footer. Output the entire corrected frame within one completed text part.',
};

/**
 * Fixed controller-authored feedback only. Never interpolate authored text,
 * capability keys, fingerprints, unknown issue codes, or proposed repairs.
 * A completed part can contain other accepted frames: this notice refers only
 * to the rejected frame and must never tell a model to resend the whole part.
 */
export function buildProtocolFeedback(issue: ProtocolIssue, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_PROTOCOL_CORRECTIONS) {
    throw new RangeError('Protocol correction attempt is outside the feedback budget');
  }
  // Diagnostics normally carry one or two counters. Bound and validate this
  // optional display metadata independently of the scanner's typed contract.
  const counters = Array.isArray(issue.sequences)
    ? [...new Set(issue.sequences.slice(0, 8).filter((value) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0))]
    : [];
  const explanation = Object.hasOwn(ISSUE_EXPLANATIONS, issue.code)
    ? ISSUE_EXPLANATIONS[issue.code]
    : ISSUE_EXPLANATIONS['invalid-header'];
  return [
    '[Commander protocol error] This frame was not sent.',
    explanation,
    ...(counters.length > 0 ? [`Rejected counters: ${counters.join(', ')}.`] : []),
    'For a correction, use a fresh counter and put that same counter on the complete header and matching END footer. Keep the intended recipient and task unchanged.',
    'Do not resend other frames already acknowledged as delivered. Wait for Commander feedback after submitting your correction.',
    `Correction notice ${attempt} of ${MAX_PROTOCOL_CORRECTIONS}.`,
    ...(attempt === MAX_PROTOCOL_CORRECTIONS
      ? ['If your next correction fails, stop and ask the user. Further automatic correction feedback is paused until the user reinjects protocol instructions.']
      : []),
  ].join(' ');
}

/**
 * A per-capability budget, not a timer or an automatic resend mechanism.
 * Only explicit capability rotation should call reset(); successful messages,
 * model output, terminal repaint, resize and elapsed time do not replenish it.
 */
export class ProtocolFeedbackBudget {
  private used = 0;

  claim(): number | null {
    if (this.used >= MAX_PROTOCOL_CORRECTIONS) return null;
    this.used += 1;
    return this.used;
  }

  reset(): void {
    this.used = 0;
  }
}
