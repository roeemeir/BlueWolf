import type { LiveRuntimeHistoryGroup, LiveRuntimeHistoryPoint } from "./live-runtime-history";

export const DISPLAY_SMOOTHING_OPTIONS_SECONDS = [0, 5, 10, 20, 30] as const;
export type DisplaySmoothingSeconds = typeof DISPLAY_SMOOTHING_OPTIONS_SECONDS[number];

function eventIdentity(group: LiveRuntimeHistoryGroup) {
  return group.event?.id ?? null;
}

function sameDisplaySegment(current: LiveRuntimeHistoryGroup, candidate: LiveRuntimeHistoryGroup) {
  return current.id === candidate.id
    && current.scoreValid
    && candidate.scoreValid
    && eventIdentity(current) === eventIdentity(candidate);
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
 * group/event and invalid score frames so a visual line cannot bleed across a
 * structural event boundary or unavailable score.
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
      if (!group.scoreValid || !Number.isFinite(now)) return group;
      const totals: number[] = [];
      const syncs: number[] = [];
      const routes: number[] = [];
      for (let index = pointIndex; index >= 0; index -= 1) {
        const sourcePoint = history[index];
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
