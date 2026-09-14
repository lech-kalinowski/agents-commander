import { describe, expect, it } from 'vitest';
import { oneCommandAccepted, settledReadySince, wholeRunAccepted } from '../live/acceptance-checks.mjs';

function acceptedBroadcast(overrides: Record<string, unknown> = {}) {
  return { sourceComplete: true, generationErrors: 0, sourceFrames: 1,
    allEventCount: 1, matchingEventCount: 1, allRouteCount: 15, expectedRouteCount: 15,
    bodyExact: true, wireBodyExactCount: 15, receiptCounts: Array.from({ length: 15 }, () => 1),
    feedbackAccepted: true, sameThread: true, untouched: true, ...overrides };
}

function whole16(overrides: Record<string, unknown> = {}) {
  return { actualEvents: 21, expectedEvents: 21, actualRoutes: 71, expectedRoutes: 71,
    allRoutesDelivered: true, allChecksPassed: true, ...overrides };
}

describe('strict real-APEX single-command acceptance', () => {
  it('accepts exactly one complete authored broadcast with one exact receipt per target', () => {
    expect(oneCommandAccepted(acceptedBroadcast())).toBe(true);
    expect(oneCommandAccepted(acceptedBroadcast({ expectedRouteCount: 1, allRouteCount: 1,
      wireBodyExactCount: 1, receiptCounts: [1] }))).toBe(true);
  });

  it.each([
    { sourceComplete: false }, { generationErrors: 1 }, { sourceFrames: 0 }, { sourceFrames: 2 },
    { allEventCount: 0 }, { allEventCount: 2 }, { matchingEventCount: 0 }, { matchingEventCount: 2 },
    { allRouteCount: 14 }, { allRouteCount: 16 }, { bodyExact: false }, { wireBodyExactCount: 14 },
    { wireBodyExactCount: 16 }, { sameThread: false }, { untouched: false },
  ])('rejects a failed or non-exact observation: %j', (bad) => {
    expect(oneCommandAccepted(acceptedBroadcast(bad))).toBe(false);
  });

  it('rejects a late duplicate even when the originally expected event/routes remain present', () => {
    const initial = acceptedBroadcast();
    expect(oneCommandAccepted(initial)).toBe(true);
    expect(oneCommandAccepted({ ...initial, allEventCount: 2, matchingEventCount: 2, allRouteCount: 30,
      wireBodyExactCount: 30, receiptCounts: Array.from({ length: 15 }, () => 2) })).toBe(false);
  });

  it('rejects an unexpected other-kind event even if matching-event and route filters still look correct', () => {
    // A STATUS/QUERY from any panel could create no extra routed ledger row.
    expect(oneCommandAccepted(acceptedBroadcast({ allEventCount: 2, matchingEventCount: 1 }))).toBe(false);
    expect(oneCommandAccepted(acceptedBroadcast({ allEventCount: 3, matchingEventCount: 1 }))).toBe(false);
  });

  it('rejects extra routes of another kind/body/source instead of filtering them away', () => {
    expect(oneCommandAccepted(acceptedBroadcast({ allRouteCount: 16 }))).toBe(false);
    expect(oneCommandAccepted(acceptedBroadcast({ allRouteCount: 17 }))).toBe(false);
  });

  it.each([
    [], Array.from({ length: 14 }, () => 1), Array.from({ length: 16 }, () => 1),
    [0, ...Array.from({ length: 14 }, () => 1)],
    [2, 0, ...Array.from({ length: 13 }, () => 1)],
    [2, ...Array.from({ length: 14 }, () => 1)],
  ])('requires exactly one full receipt for every target: %j', (...receiptCounts) => {
    expect(oneCommandAccepted(acceptedBroadcast({ receiptCounts }))).toBe(false);
  });

  it('never accepts a partial or substring receipt count as an exact full-body receipt', () => {
    // The live source reader must report only full-body matches in these counts.
    const counts = Array.from({ length: 15 }, () => 1);
    counts[7] = 0;
    expect(oneCommandAccepted(acceptedBroadcast({ receiptCounts: counts }))).toBe(false);
  });

  it('does not mistake sparse target arrays for complete receipt evidence', () => {
    expect(oneCommandAccepted(acceptedBroadcast({ receiptCounts: new Array(15) }))).toBe(false);
    const sparse = Array.from({ length: 15 }, () => 1);
    delete sparse[7];
    expect(oneCommandAccepted(acceptedBroadcast({ receiptCounts: sparse }))).toBe(false);
  });

  it('requires response/ACK proof for no-route STATUS and QUERY commands', () => {
    const noRoutes = acceptedBroadcast({ expectedRouteCount: 0, allRouteCount: 0,
      wireBodyExactCount: 0, receiptCounts: [] });
    expect(oneCommandAccepted(noRoutes)).toBe(true);
    expect(oneCommandAccepted({ ...noRoutes, feedbackAccepted: false })).toBe(false);
    expect(oneCommandAccepted({ ...noRoutes, feedbackAccepted: undefined })).toBe(false);
    expect(oneCommandAccepted({ ...noRoutes, allRouteCount: 1 })).toBe(false);
  });

  it.each([NaN, Infinity, -1, 1.5, '1', undefined, null])('does not coerce invalid counts: %s', (value) => {
    for (const field of ['generationErrors', 'sourceFrames', 'allEventCount', 'matchingEventCount',
      'allRouteCount', 'expectedRouteCount', 'wireBodyExactCount']) {
      expect(oneCommandAccepted(acceptedBroadcast({ [field]: value }))).toBe(false);
    }
  });

  it('requires literal booleans and does not mutate caller observations', () => {
    for (const field of ['sourceComplete', 'bodyExact', 'sameThread', 'untouched']) {
      expect(oneCommandAccepted(acceptedBroadcast({ [field]: 'true' }))).toBe(false);
    }
    const input = acceptedBroadcast();
    const before = structuredClone(input);
    oneCommandAccepted(input);
    expect(input).toEqual(before);
    expect(oneCommandAccepted(null)).toBe(false);
    expect(oneCommandAccepted([])).toBe(false);
  });
});

describe('whole-run event and route conservation', () => {
  it('accepts exactly 21 authored events and 71 delivered routes for the 16-panel stress run', () => {
    expect(wholeRunAccepted(whole16())).toBe(true);
  });

  it('accepts exactly 21 authored events and 31 delivered routes for the 6-panel stress run', () => {
    expect(wholeRunAccepted(whole16({ actualRoutes: 31, expectedRoutes: 31 }))).toBe(true);
    expect(wholeRunAccepted(whole16({ actualRoutes: 32, expectedRoutes: 31 }))).toBe(false);
  });

  it.each([
    { actualEvents: 20 }, { actualEvents: 22 }, { actualRoutes: 70 }, { actualRoutes: 72 },
    { allRoutesDelivered: false }, { allChecksPassed: false }, { allChecksPassed: 'true' },
    { actualEvents: NaN }, { actualRoutes: 71.5 }, { expectedEvents: '21' },
  ])('rejects unmatched totals, late/gap traffic or unsuccessful checks: %j', (bad) => {
    expect(wholeRunAccepted(whole16(bad))).toBe(false);
  });

  it('does not bless an empty run or infer successful delivery from aggregate counts', () => {
    expect(wholeRunAccepted({ actualEvents: 0, expectedEvents: 0, actualRoutes: 0, expectedRoutes: 0,
      allRoutesDelivered: true, allChecksPassed: true })).toBe(false);
    expect(wholeRunAccepted(whole16({ allRoutesDelivered: undefined }))).toBe(false);
    expect(wholeRunAccepted(null)).toBe(false);
  });
});

describe('continuous settled acceptance window', () => {
  it('requires acceptance and all-panel readiness throughout the default 2500 ms grace', () => {
    const start = settledReadySince(null, { accepted: true, allReady: true, now: 1000 });
    expect(start).toEqual({ since: 1000, settled: false });
    expect(settledReadySince(start.since, { accepted: true, allReady: true, now: 3499 }))
      .toEqual({ since: 1000, settled: false });
    expect(settledReadySince(start.since, { accepted: true, allReady: true, now: 3500 }))
      .toEqual({ since: 1000, settled: true });
  });

  it('resets on late duplicates/unexpected traffic even when every agent remains ready', () => {
    const initial = settledReadySince(null, { accepted: oneCommandAccepted(acceptedBroadcast()), allReady: true, now: 1000 });
    const duplicate = settledReadySince(initial.since, {
      accepted: oneCommandAccepted(acceptedBroadcast({ allEventCount: 2 })), allReady: true, now: 3499,
    });
    expect(duplicate).toEqual({ since: null, settled: false });
    expect(settledReadySince(duplicate.since, { accepted: false, allReady: true, now: 10000 }))
      .toEqual({ since: null, settled: false });
  });

  it('restarts the full grace after a readiness interruption, not merely the remaining delay', () => {
    expect(settledReadySince(1000, { accepted: true, allReady: false, now: 3400 }))
      .toEqual({ since: null, settled: false });
    const restarted = settledReadySince(null, { accepted: true, allReady: true, now: 3500 });
    expect(settledReadySince(restarted.since, { accepted: true, allReady: true, now: 5900 }).settled).toBe(false);
    expect(settledReadySince(restarted.since, { accepted: true, allReady: true, now: 6000 }).settled).toBe(true);
  });

  it('handles zero timestamps, clock regression and invalid observations without premature settling', () => {
    expect(settledReadySince(0, { accepted: true, allReady: true, now: 2500 })).toEqual({ since: 0, settled: true });
    expect(settledReadySince(5000, { accepted: true, allReady: true, now: 4000 })).toEqual({ since: 4000, settled: false });
    expect(settledReadySince(0, { accepted: 'true', allReady: true, now: 9999 })).toEqual({ since: null, settled: false });
    expect(settledReadySince(0, { accepted: true, allReady: true, now: NaN })).toEqual({ since: null, settled: false });
    expect(settledReadySince(0, { accepted: true, allReady: true, now: 9999 }, -1)).toEqual({ since: null, settled: false });
    expect(settledReadySince(null, null)).toEqual({ since: null, settled: false });
  });
});
