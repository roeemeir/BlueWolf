import type { LiveRuntimeHistoryGroup, LiveRuntimeHistoryPoint } from "./live-runtime-history";

export const DISPLAY_SMOOTHING_OPTIONS_SECONDS = [0, 5, 10, 20, 30] as const;
export type DisplaySmoothingSeconds = typeof DISPLAY_SMOOTHING_OPTIONS_SECONDS[number];

function eventIdentity(group: LiveRuntimeHistoryGroup) {
  return group.event?.id ?? null;
}

function hasFiniteScores(group: LiveRuntimeHistoryGroup) {
  return Number.isFinite(group.total)
    && Number.isFinite(group.sync)
    && Number.isFinite(group.route);
}

function sameDisplaySegment(current: LiveRuntimeHistoryGroup, candidate: LiveRuntimeHistoryGroup) {
  return current.id === candidate.id
    && current.scoreValid
    && candidate.scoreValid
    && hasFiniteScores(current)
    && hasFiniteScores(candidate)
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
 * BW-SYNC-013 display-only trailing smoothing.
 *
 * The function never mutates the supplied Core history and never feeds a
 * smoothed value back into scoring, alerts, grouping or event lifecycle. A
 * window of zero is an explicit raw-display mode. Smoothing is segmented by
 * server, navigation origin, group/event and invalid score frames so a visual
 * line cannot bleed across TEST and operational navigation, a server switch,
 * structural event boundary or unavailable score.
 *
 * NOTE: A Core-scored runtime can already smooth its selected group total.
 * This display function is not a second independent source of raw scores;
 * the Core raw/display distinction must be carried in the runtime contract
 * before configurable windows can be claimed to represent raw Core totals.
 */
export function smoothRuntimeHistoryForDisplay(
  history: readonly LiveRuntimeHistoryPoint[],
  windowSeconds: number,
): LiveRuntimeHistoryPoint[] {
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0 || windowSeconds > 300) {
    throw new Error("display smoothing window must be in [0,300] seconds");
  }
  const output = structuredClone(history) as LiveRuntimeHistoryPoint[];
  if (windowSeconds === 0 || output.length < 2) return output;
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
        // Group and event identifiers are only meaningful within their source
        // server and navigation origin. Never blend a TEST/Core score into an
        // operational score, even when the route/group/event ids are identical.
        if (sourcePoint.serverId !== point.serverId || !sameNavigationOrigin(point, sourcePoint)) break;
        const age = now - Date.parse(sourcePoint.observedAt);
        if (!Number.isFinite(age) || age < 0 || age > windowMs) break;
        const candidate = sourcePoint.groups.find((item) => item.id === group.id);
        if (!candidate || !sameDisplaySegment(group, candidate)) break;
        totals.push(candidate.total);
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
