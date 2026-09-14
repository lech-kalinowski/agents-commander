// Pure acceptance predicates shared by opt-in live QA and offline regressions.
// Importing this module never launches providers, reads sessions or writes data.
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

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
