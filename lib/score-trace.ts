export type ScoreTracePoint = {
  timeMs: number; groupId: string; eventId: string; vehicleId: number;
  latitude: number; longitude: number; sync: number | null;
};

export function traceScoreColor(score: number | null): string {
  return score === null || !Number.isFinite(score) ? "#88939f" : score >= 80 ? "#29b67a" : score >= 50 ? "#edb443" : "#e35e6a";
}

/** Source-time deduplication; no line may bridge missing navigation or an event boundary. */
export function mergeScoreTrace(previous: ScoreTracePoint[], incoming: ScoreTracePoint[], horizonMs = 30 * 60_000): ScoreTracePoint[] {
  const rows = new Map(previous.map(point => [`${point.vehicleId}:${point.timeMs}`, point]));
  for (const point of incoming) {
    if (![point.timeMs, point.latitude, point.longitude].every(Number.isFinite)) continue;
    rows.set(`${point.vehicleId}:${point.timeMs}`, point);
  }
  const ordered = [...rows.values()].sort((a, b) => a.timeMs - b.timeMs || a.vehicleId - b.vehicleId);
  const end = ordered.at(-1)?.timeMs ?? 0;
  return ordered.filter(point => point.timeMs >= end - horizonMs).slice(-30_000);
}

export function traceSegments<T extends ScoreTracePoint>(points: T[], maxGapMs = 10_000): [T, T][] {
  const latest = new Map<number, T>();
  const segments: [T, T][] = [];
  for (const point of points) {
    const prior = latest.get(point.vehicleId);
    if (prior && point.timeMs > prior.timeMs && point.timeMs - prior.timeMs <= maxGapMs && point.groupId === prior.groupId && point.eventId === prior.eventId) segments.push([prior, point]);
    latest.set(point.vehicleId, point);
  }
  return segments;
}
