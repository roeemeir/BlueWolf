import type { LiveRuntimeHistoryGroup, LiveRuntimeHistoryPoint } from "./live-runtime-history";

export const DISPLAY_SMOOTHING_OPTIONS_SECONDS = [0, 5, 10, 20, 30] as const;
export type DisplaySmoothingSeconds = typeof DISPLAY_SMOOTHING_OPTIONS_SECONDS[number];

function eventIdentity(group: LiveRuntimeHistoryGroup) {
  return group.event?.id ?? null;
}

function rawScore(group: LiveRuntimeHistoryGroup) {
  // Backward-compatible legacy history has no rawTotal. Never fabricate one
  // by claiming its already-filtered Core total to be an original observation.
  return group.rawTotal === undefined ? group.total : group.rawTotal;
}

function hasFiniteScores(group: LiveRuntimeHistoryGroup) {
  return Number.isFinite(group.total)
    && (group.rawTotal === undefined || Number.isFinite(group.rawTotal))
    && Number.isFinite(group.sync)
    && Number.isFinite(group.route);
}

function sameDisplaySegment(current: LiveRuntimeHistoryGroup, candidate: LiveRuntimeHistoryGroup) {
  return current.id === candidate.id
    && current.scoreValid
    && candidate.scoreValid
    && hasFiniteScores(current)
    && hasFiniteScores(candidate)
    // A legacy filtered total cannot be averaged into an independently
    // observed raw-total segment, even on the same group and event.
    && (current.rawTotal === undefined) === (candidate.rawTotal === undefined)
    && eventIdentity(current) === eventIdentity(candidate);
}

function sameNavigationOrigin(current: LiveRuntimeHistoryPoint, candidate: LiveRuntimeHistoryPoint) {
  // History source is present only for explicitly marked Core-scored TEST
  // navigation. Matching server/group/event IDs do not authorize averaging
  // synthetic navigation scores into an unmarked operational chart segment.
  return (current.source?.syntheticNavigation === true) === (candidate.source?.syntheticNavigation === true);
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * BW-SYNC-013 display-only trailing smoothing. Core total is never altered
 * in the input history: event/alert decisions always retain Core's checkpointed
 * ten-second total. Where Core publishes rawTotal, the zero-second display
 * shows that original and every configurable nonzero window averages ONLY
 * original Core totals, not a second average of a filtered alert score.
 * Legacy history with no rawTotal remains backward-readable; its original
 * score cannot be reconstructed from a prior moving mean.
 * Segments stop at navigation source, server, group/event, validity or
 * raw/legacy provenance boundaries.
 */
export function smoothRuntimeHistoryForDisplay(
  history: readonly LiveRuntimeHistoryPoint[],
  windowSeconds: number,
): LiveRuntimeHistoryPoint[] {
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0 || windowSeconds > 300) {
    throw new Error("display smoothing window must be in [0,300] seconds");
  }
  const output = structuredClone(history) as LiveRuntimeHistoryPoint[];
  if (windowSeconds === 0 || output.length < 2) {
    output.forEach((point) => {
      point.groups = point.groups.map((group) => group.scoreValid && group.rawTotal !== undefined
        ? { ...group, total: group.rawTotal }
        : group);
    });
    return output;
  }
  const windowMs = windowSeconds * 1000;

  output.forEach((point, pointIndex) => {
    const now = Date.parse(point.observedAt);
    point.groups = point.groups.map((group) => {
      if (!group.scoreValid || !hasFiniteScores(group) || !Number.isFinite(now)) return group;
      const totals: number[] = [];
      const syncs: number[] = [];
      const routes: number[] = [];
      for (let index = pointIndex; index >= 0; index -= 1) {
        const sourcePoint = history[index];
        if (sourcePoint.serverId !== point.serverId || !sameNavigationOrigin(point, sourcePoint)) break;
        const age = now - Date.parse(sourcePoint.observedAt);
        if (!Number.isFinite(age) || age < 0 || age > windowMs) break;
        const candidate = sourcePoint.groups.find((item) => item.id === group.id);
        if (!candidate || !sameDisplaySegment(group, candidate)) break;
        totals.push(rawScore(candidate));
        syncs.push(candidate.sync);
        routes.push(candidate.route);
      }
      if (!totals.length) return group;
      return {
        ...group,
        total: mean(totals),
        sync: mean(syncs),
        route: mean(routes),
      };
    });
  });
  return output;
}
