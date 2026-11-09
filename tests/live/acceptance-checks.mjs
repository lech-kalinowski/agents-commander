// Pure acceptance predicates shared by opt-in live QA and offline regressions.
// Importing this module never launches providers, reads sessions or writes data.
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function hasKnownOpenCodePasteSeparator(version) {
  return version === '1.18.30' || version === '1.18.31';
}

/** Exact wire text, or the one verified paste-summary separator on known versions. */
export function openCodeStoredInputMatches(version, stored, wire) {
  if (typeof stored !== 'string' || typeof wire !== 'string') return false;
  return stored === wire || (hasKnownOpenCodePasteSeparator(version)
    && (wire.split('\n').length >= 3 || wire.length > 150) && stored === wire + ' ');
}

/** Independent exact expected text for the opt-in malformed-both-delimiters trial. */
export function expectedCorrectionFeedback(counter, code = 'missing-both-delimiters', attempt = 1) {
  if (!Number.isSafeInteger(counter) || counter < 1 || !Number.isInteger(attempt) || attempt < 1 || attempt > 3) return null;
  const descriptions = {
    'missing-header-delimiter': 'Missing closing === on the header.',
    'missing-footer-delimiter': 'Missing closing === on the END footer.',
    'missing-both-delimiters': 'Missing closing === on both the header and END footer.',
  };
  if (!Object.hasOwn(descriptions, code)) return null;
  return [
    '[Commander protocol error] This frame was not sent.',
    descriptions[code],
    `Rejected counters: ${counter}.`,
    'For a correction, use a fresh counter and put that same counter on the complete header and matching END footer. Keep the intended recipient and task unchanged.',
    'Do not resend other frames already acknowledged as delivered. Wait for Commander feedback after submitting your correction.',
    `Correction notice ${attempt} of 3.`,
    ...(attempt === 3 ? ['If your next correction fails, stop and ask the user. Further automatic correction feedback is paused until the user reinjects protocol instructions.'] : []),
  ].join(' ');
}

/** Model text may surround a frame with blank LF lines; its three lines remain exact. */
export function exactMalformedCorrectionShape(text, expected) {
  if (typeof text !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  return text.replace(/^\n+|\n+$/g, '') === expected;
}

/** Require the complete, unfiltered observation window, not just matching rows. */
export function oneCommandAccepted(input) {
  if (!isRecord(input)) return false;
  const { sourceComplete, generationErrors, sourceFrames, allEventCount, matchingEventCount,
    allRouteCount, expectedRouteCount, bodyExact, wireBodyExactCount, receiptCounts,
    feedbackAccepted, sameThread, untouched } = input;
  if (![generationErrors, sourceFrames, allEventCount, matchingEventCount,
    allRouteCount, expectedRouteCount, wireBodyExactCount].every(isCount)) return false;
  return sourceComplete === true && generationErrors === 0 && sourceFrames === 1
    && allEventCount === 1 && matchingEventCount === 1
    && allRouteCount === expectedRouteCount && bodyExact === true
    && wireBodyExactCount === expectedRouteCount
    && Array.isArray(receiptCounts) && receiptCounts.length === expectedRouteCount
    // Array.every skips holes; an unfilled target slot is missing evidence.
    && Array.from(receiptCounts).every(count => count === 1)
    && (expectedRouteCount !== 0 || feedbackAccepted === true)
    && sameThread === true && untouched === true;
}

/** A rejected authored frame must recover through one real controller-feedback turn. */
export function correctionAccepted(input) {
  if (!oneCommandAccepted(input)) return false;
  const { malformedFrames, controllerFeedbackCount, feedbackWireCount, feedbackStoredCount,
    malformedComplete, malformedShapeExact, feedbackExact, correctionSequenceFresh,
    correctedAfterFeedback, sameSourceSession, deliveryAckReceived } = input;
  return [malformedFrames, controllerFeedbackCount, feedbackWireCount, feedbackStoredCount]
    .every(value => isCount(value) && value === 1)
    && [malformedComplete, malformedShapeExact, feedbackExact, correctionSequenceFresh,
      correctedAfterFeedback, sameSourceSession, deliveryAckReceived].every(value => value === true);
}

/** Every additional notice needs an independent successful-recovery audit. */
export function correctionAccountingAccepted(input) {
  if (!isRecord(input)) return false;
  const { totalFeedback, incidentalRecoveries, unaccountedCorrectionFeedback, intentionalPassed } = input;
  return [totalFeedback, incidentalRecoveries, unaccountedCorrectionFeedback].every(isCount)
    && intentionalPassed === true && unaccountedCorrectionFeedback === 0
    && totalFeedback === incidentalRecoveries + 1;
}

/** A final whole-run conservation check catches traffic between trial windows. */
export function wholeRunAccepted(input) {
  if (!isRecord(input)) return false;
  const { actualEvents, expectedEvents, actualRoutes, expectedRoutes,
    allRoutesDelivered, allChecksPassed } = input;
  if (![actualEvents, expectedEvents, actualRoutes, expectedRoutes].every(isCount) || expectedEvents < 1) return false;
  return actualEvents === expectedEvents && actualRoutes === expectedRoutes
    && allRoutesDelivered === true && allChecksPassed === true;
}

/** Re-evaluate acceptance throughout the grace period; readiness alone is not enough. */
export function settledReadySince(previousSince, observation, graceMs = 2500) {
  if (!isRecord(observation) || observation.accepted !== true || observation.allReady !== true
    || !isCount(observation.now) || !isCount(graceMs)) return { since: null, settled: false };
  const since = isCount(previousSince) && previousSince <= observation.now ? previousSince : observation.now;
  return { since, settled: observation.now - since >= graceMs };
}
