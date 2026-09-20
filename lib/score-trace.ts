import { continuousObservedNavigationSegment, validObservedWgs84 } from "./observed-navigation-continuity";

export type ScoreTracePoint = {
  timeMs: number; groupId: string; eventId: string; vehicleId: number;
  latitude: number; longitude: number; sync: number | null;
};

export const DEFAULT_TRACE_WINDOW_MINUTES = 30;
export const TRACE_RETENTION_MINUTES = 90;

export function traceScoreColor(score: number | null): string {
  return score === null || !Number.isFinite(score) ? "#88939f" : score >= 80 ? "#29b67a" : score >= 50 ? "#edb443" : "#e35e6a";
}

/** Refuse coordinates outside WGS84. Finite but impossible fixes must not enter
 * either the map projection or the scored trace. */
function validTraceFix(point: ScoreTracePoint): boolean {
  return Number.isFinite(point.timeMs)
    && Number.isInteger(point.vehicleId)
    && validObservedWgs84(point);
}

/** A vehicle can have adjacent event/group evidence at the same source time.
 * Deduplicating by vehicle+time alone silently loses one event during replay. */
function traceIdentity(point: ScoreTracePoint): string {
  return JSON.stringify([point.vehicleId, point.timeMs, point.groupId, point.eventId]);
}

/** Source-time deduplication preserves event/group provenance and never joins
 * distinct event identities. Invalid WGS84 fixes are not projected. */
export function mergeScoreTrace(previous: ScoreTracePoint[], incoming: ScoreTracePoint[], horizonMs = TRACE_RETENTION_MINUTES * 60_000): ScoreTracePoint[] {
  const rows = new Map<string, ScoreTracePoint>();
  for (const point of previous) {
    if (validTraceFix(point)) rows.set(traceIdentity(point), point);
  }
  for (const point of incoming) {
    if (!validTraceFix(point)) continue;
    rows.set(traceIdentity(point), point);
  }
  const ordered = [...rows.values()].sort((a, b) => a.timeMs - b.timeMs || a.vehicleId - b.vehicleId);
  const end = ordered.at(-1)?.timeMs ?? 0;
  return ordered.filter(point => point.timeMs >= end - horizonMs).slice(-90_000);
}

export function filterTraceWindow<T extends ScoreTracePoint>(points: readonly T[], minutes = DEFAULT_TRACE_WINDOW_MINUTES): T[] {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("trace window minutes must be positive");
  const finite = points.filter(validTraceFix);
  if (!finite.length) return [];
  // Callers normally pass a sorted merge, but a raw Core replay can arrive out
  // of order. Anchor the window to the newest source timestamp.
  const end = finite.reduce((latest, point) => Math.max(latest, point.timeMs), Number.NEGATIVE_INFINITY);
  const threshold = end - minutes * 60_000;
  return finite.filter((point) => point.timeMs >= threshold && point.timeMs <= end)
    .sort((a, b) => a.timeMs - b.timeMs || a.vehicleId - b.vehicleId);
}

export function traceSegments<T extends ScoreTracePoint>(points: T[], maxGapMs = 10_000): [T, T][] {
  // Keep separate event/group lines only across consecutive observed times for
  // that vehicle. If a vehicle changes group and later returns within 10 s, an
  // old line must NOT be revived across the intervening group membership.
  const latest = new Map<string, T>();
  const currentTimeByVehicle = new Map<number, number>();
  const priorTimeByVehicle = new Map<number, number>();
  const segments: [T, T][] = [];
  for (const point of [...points].sort((a, b) => a.timeMs - b.timeMs || a.vehicleId - b.vehicleId)) {
    const lastTime = currentTimeByVehicle.get(point.vehicleId);
    if (lastTime !== point.timeMs) {
      priorTimeByVehicle.set(point.vehicleId, lastTime ?? Number.NaN);
      currentTimeByVehicle.set(point.vehicleId, point.timeMs);
    }
    if (!validTraceFix(point)) {
      if (Number.isInteger(point.vehicleId)) {
        for (const [key, prior] of latest) if (prior.vehicleId === point.vehicleId) latest.delete(key);
      }
      continue;
    }
    const key = JSON.stringify([point.vehicleId, point.groupId, point.eventId]);
    const prior = latest.get(key);
    if (prior && prior.timeMs === priorTimeByVehicle.get(point.vehicleId)
      && continuousObservedNavigationSegment(prior, point, point.timeMs - prior.timeMs, maxGapMs)) {
      segments.push([prior, point]);
    }
    latest.set(key, point);
  }
  return segments;
}
