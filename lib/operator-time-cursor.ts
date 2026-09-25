import type { LiveRuntimeHistoryGroup, LiveRuntimeHistoryPoint } from "@/lib/live-runtime-history";
import type { ScoreTracePoint } from "@/lib/score-trace";

export const OPERATOR_CURSOR_TOLERANCE_MS = 10_000;
export const OPERATOR_CURSOR_EVENT = "bluewolf:operator-time-cursor" as const;

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

type OperatorCursorDetail = { serverId: string; observedAt: string | null };
const CURSOR_BY_SERVER = new Map<string, string | null>();

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
    // A selected history frame must never acquire navigation measured AFTER its
    // source timestamp, even if that fix is closer than the last known fix.
    if (!Number.isFinite(row.timeMs) || row.timeMs > target || target - row.timeMs > toleranceMs
      || !Number.isInteger(row.vehicleId)
      || !Number.isFinite(row.latitude) || row.latitude < -90 || row.latitude > 90
      || !Number.isFinite(row.longitude) || row.longitude < -180 || row.longitude > 180) continue;
    const group = groupById.get(row.groupId);
    if (!group) continue;
    // Eventless Core snapshots have an explicit group-id fallback in the trace
    // contract. Never accept an arbitrary previous event merely because its
    // group ID matches an eventless history frame.
    const expectedEventId = group.event?.id ?? group.id;
    if (row.eventId !== expectedEventId) continue;
    const current = bestByVehicle.get(row.vehicleId);
    if (!current || row.timeMs > current.timeMs) bestByVehicle.set(row.vehicleId, row);
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
  if (cursorTimeMs === null) return trace.map((row) => ({ ...row }));
  if (!Number.isFinite(cursorTimeMs)) return [];
  return trace.filter((row) => Number.isFinite(row.timeMs) && row.timeMs <= cursorTimeMs).map((row) => ({ ...row }));
}

/** Client-only ephemeral bus. It deliberately does not persist a cursor across restart/session. */
export function publishOperatorCursor(serverId: string, observedAt: string | null) {
  CURSOR_BY_SERVER.set(serverId, observedAt);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OperatorCursorDetail>(OPERATOR_CURSOR_EVENT, { detail: { serverId, observedAt } }));
}

export function currentOperatorCursor(serverId: string) {
  return CURSOR_BY_SERVER.get(serverId) ?? null;
}

export function subscribeOperatorCursor(serverId: string, listener: (observedAt: string | null) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<OperatorCursorDetail>).detail;
    if (!detail || detail.serverId !== serverId) return;
    listener(detail.observedAt);
  };
  window.addEventListener(OPERATOR_CURSOR_EVENT, handler);
  return () => window.removeEventListener(OPERATOR_CURSOR_EVENT, handler);
}
