import type { LiveRuntimeHistoryGroup, LiveRuntimeHistoryPoint } from "@/lib/live-runtime-history";
import type { ScoreTracePoint } from "@/lib/score-trace";

export const OPERATOR_CURSOR_TOLERANCE_MS = 10_000;

export type OperatorCursorVehicle = {
  vehicleId: number;
  groupId: string;
  eventId: string;
  latitude: number;
  longitude: number;
  sync: number | null;
  timeMs: number;
};

export type OperatorCursorFrame = {
  observedAt: string;
  timeMs: number;
  groups: LiveRuntimeHistoryGroup[];
  vehicles: OperatorCursorVehicle[];
};

function finiteTime(value: string) {
  const timeMs = Date.parse(value);
  return Number.isFinite(timeMs) ? timeMs : null;
}

export function nearestHistoryPoint(
  history: readonly LiveRuntimeHistoryPoint[],
  observedAt: string,
  toleranceMs = OPERATOR_CURSOR_TOLERANCE_MS,
): LiveRuntimeHistoryPoint | null {
  const target = finiteTime(observedAt);
  if (target === null || !Number.isFinite(toleranceMs) || toleranceMs < 0) return null;
  let best: LiveRuntimeHistoryPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of history) {
    const time = finiteTime(point.observedAt);
    if (time === null) continue;
    const distance = Math.abs(time - target);
    if (distance < bestDistance || (distance === bestDistance && best && time <= target && Date.parse(best.observedAt) > target)) {
      best = point;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= toleranceMs ? structuredClone(best) : null;
}

export function resolveOperatorCursorFrame(
  history: readonly LiveRuntimeHistoryPoint[],
  trace: readonly ScoreTracePoint[],
  observedAt: string,
  toleranceMs = OPERATOR_CURSOR_TOLERANCE_MS,
): OperatorCursorFrame | null {
  const point = nearestHistoryPoint(history, observedAt, toleranceMs);
  if (!point) return null;
  const target = Date.parse(point.observedAt);
  const groupById = new Map(point.groups.map((group) => [group.id, group]));
  const bestByVehicle = new Map<number, ScoreTracePoint>();

  for (const row of trace) {
    if (!Number.isFinite(row.timeMs) || Math.abs(row.timeMs - target) > toleranceMs) continue;
    const group = groupById.get(row.groupId);
    if (!group) continue;
    if (group.event?.id && group.event.id !== row.eventId) continue;
    const current = bestByVehicle.get(row.vehicleId);
    if (!current) {
      bestByVehicle.set(row.vehicleId, row);
      continue;
    }
    const currentDistance = Math.abs(current.timeMs - target);
    const nextDistance = Math.abs(row.timeMs - target);
    const preferNext = nextDistance < currentDistance
      || (nextDistance === currentDistance && row.timeMs <= target && current.timeMs > target);
    if (preferNext) bestByVehicle.set(row.vehicleId, row);
  }

  return {
    observedAt: point.observedAt,
    timeMs: target,
    groups: structuredClone(point.groups),
    vehicles: [...bestByVehicle.values()].map((row) => ({
      vehicleId: row.vehicleId,
      groupId: row.groupId,
      eventId: row.eventId,
      latitude: row.latitude,
      longitude: row.longitude,
      sync: row.sync,
      timeMs: row.timeMs,
    })),
  };
}

export function traceUpToCursor<T extends ScoreTracePoint>(trace: readonly T[], cursorTimeMs: number | null): T[] {
  if (cursorTimeMs === null || !Number.isFinite(cursorTimeMs)) return trace.map((row) => ({ ...row }));
  return trace.filter((row) => row.timeMs <= cursorTimeMs).map((row) => ({ ...row }));
}
