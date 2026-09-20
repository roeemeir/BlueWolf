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
    && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
    && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180;
}

/** Source-time deduplication; no line may bridge missing navigation or an event boundary. */
export function mergeScoreTrace(previous: ScoreTracePoint[], incoming: ScoreTracePoint[], horizonMs = TRACE_RETENTION_MINUTES * 60_000): ScoreTracePoint[] {
  const rows = new Map<string, ScoreTracePoint>();
  for (const point of previous) {
    if (validTraceFix(point)) rows.set(`${point.vehicleId}:${point.timeMs}`, point);
  }
  for (const point of incoming) {
    if (!validTraceFix(point)) continue;
    rows.set(`${point.vehicleId}:${point.timeMs}`, point);
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
  // of order. Always anchor the window to the newest source timestamp, never
  // to the last array element (which might be an older late-arriving sample).
  const end = finite.reduce((latest, point) => Math.max(latest, point.timeMs), Number.NEGATIVE_INFINITY);
  const threshold = end - minutes * 60_000;
  return finite.filter((point) => point.timeMs >= threshold && point.timeMs <= end)
    .sort((a, b) => a.timeMs - b.timeMs || a.vehicleId - b.vehicleId);
}

export function traceSegments<T extends ScoreTracePoint>(points: T[], maxGapMs = 10_000): [T, T][] {
  const latest = new Map<number, T>();
  const segments: [T, T][] = [];
  for (const point of [...points].sort((a, b) => a.timeMs - b.timeMs || a.vehicleId - b.vehicleId)) {
    if (!validTraceFix(point)) {
      if (Number.isInteger(point.vehicleId)) latest.delete(point.vehicleId);
      continue;
    }
    const prior = latest.get(point.vehicleId);
    if (prior && point.timeMs > prior.timeMs && point.timeMs - prior.timeMs <= maxGapMs && point.groupId === prior.groupId && point.eventId === prior.eventId) segments.push([prior, point]);
    latest.set(point.vehicleId, point);
  }
  return segments;
}
