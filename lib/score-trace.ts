import { continuousObservedNavigationSegment, validObservedWgs84 } from "./observed-navigation-continuity";

export type ScoreTracePoint = {
  timeMs: number; groupId: string; eventId: string; vehicleId: number;
  latitude: number; longitude: number; sync: number | null;
  /** Display-only boundary on the LAST observed fix before a known missing sample. */
  breakAfter?: boolean;
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

/**
 * An operational snapshot can omit a vehicle's fix altogether: the upstream
 * normalizer deliberately represents unavailable WGS84 with absent coordinates,
 * and the runtime collector forwards only valid positions to this merge. The
 * absence is still evidence of a gap. Mark the last observed fix, not an
 * invented position, so the next valid fix cannot be joined across the hole.
 *
 * The caller passes one server's trace and one snapshot at a time. Do not use a
 * global vehicle cache: identically numbered vehicles on independent servers
 * must never affect each other's continuity. A later/duplicate observation
 * cannot erase an already established breakAfter boundary.
 */
export function mergeScoreTrace(previous: ScoreTracePoint[], incoming: ScoreTracePoint[], horizonMs = TRACE_RETENTION_MINUTES * 60_000): ScoreTracePoint[] {
  const rows = new Map<string, ScoreTracePoint>();
  for (const point of previous) {
    if (validTraceFix(point)) rows.set(traceIdentity(point), { ...point });
  }
  const latestPreviousByVehicle = new Map<number, ScoreTracePoint>();
  for (const point of rows.values()) {
    const latest = latestPreviousByVehicle.get(point.vehicleId);
    if (!latest || latest.timeMs < point.timeMs) latestPreviousByVehicle.set(point.vehicleId, point);
  }
  const validIncoming = incoming.filter(validTraceFix);
  const latestIncomingTime = validIncoming.reduce((last, point) => Math.max(last, point.timeMs), Number.NEGATIVE_INFINITY);
  const observedVehicles = new Set(validIncoming.map((point) => point.vehicleId));
  for (const [vehicleId, prior] of latestPreviousByVehicle) {
    if (!observedVehicles.has(vehicleId) && (incoming.length === 0 || latestIncomingTime > prior.timeMs)) {
      prior.breakAfter = true;
    }
  }
  // Invalid fixes that DO reach the collector must also sever the previous
  // observed segment; the bad coordinates themselves are never retained or
  // projected. A missing fix omitted upstream is covered by the absent-id case.
  for (const invalid of incoming) {
    if (validTraceFix(invalid) || !Number.isInteger(invalid.vehicleId) || !Number.isFinite(invalid.timeMs)) continue;
    let latestBefore: ScoreTracePoint | undefined;
    for (const point of rows.values()) {
      if (point.vehicleId === invalid.vehicleId && point.timeMs < invalid.timeMs
        && (!latestBefore || point.timeMs > latestBefore.timeMs)) latestBefore = point;
    }
    for (const point of validIncoming) {
      if (point.vehicleId === invalid.vehicleId && point.timeMs < invalid.timeMs
        && (!latestBefore || point.timeMs > latestBefore.timeMs)) latestBefore = point;
    }
    if (latestBefore) {
      const identity = traceIdentity(latestBefore);
      const existing = rows.get(identity);
      if (existing) existing.breakAfter = true;
      else rows.set(identity, { ...latestBefore, breakAfter: true });
    }
  }
  for (const point of validIncoming) {
    const identity = traceIdentity(point);
    rows.set(identity, { ...point, breakAfter: point.breakAfter === true || rows.get(identity)?.breakAfter === true });
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
    if (prior && !prior.breakAfter && prior.timeMs === priorTimeByVehicle.get(point.vehicleId)
      && continuousObservedNavigationSegment(prior, point, point.timeMs - prior.timeMs, maxGapMs)) {
      segments.push([prior, point]);
    }
    latest.set(key, point);
  }
  return segments;
}
