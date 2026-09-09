import type { LiveRuntimeSnapshot } from "./live-runtime";

export type LivePositionHistoryPoint = {
  observedAt: string;
  bucketMs: number;
  groupId: string;
  groupName: string;
  groupColor: string;
  vehicleId: number;
  typeId: string;
  latitude: number;
  longitude: number;
  sync: number | null;
};

const POSITION_BUCKET_MS = 5_000;
const DEFAULT_TRAIL_MINUTES = 30;
const HARD_MAX_POINTS_PER_SERVER = 100_000;
const CACHE: Record<string, LivePositionHistoryPoint[]> = {};

function validDateMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function appendLivePositionHistory(snapshot: LiveRuntimeSnapshot) {
  const observedMs = validDateMs(snapshot.observedAt);
  if (observedMs === null) return;
  const bucketMs = Math.floor(observedMs / POSITION_BUCKET_MS) * POSITION_BUCKET_MS;
  const incoming = (snapshot.groupList ?? Object.values(snapshot.groups)).flatMap((group) => {
    if (!group) return [];
    return group.members.flatMap((vehicle) => {
      if (vehicle.latitude === undefined || vehicle.longitude === undefined) return [];
      return [{
        observedAt: snapshot.observedAt,
        bucketMs,
        groupId: group.id,
        groupName: group.name,
        groupColor: group.color,
        vehicleId: vehicle.id,
        typeId: vehicle.typeId,
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
        sync: vehicle.scoreValid && Number.isFinite(vehicle.sync) ? vehicle.sync : null,
      } satisfies LivePositionHistoryPoint];
    });
  });
  if (incoming.length === 0) return;

  const existing = CACHE[snapshot.serverId] ?? [];
  const replacementKeys = new Set(incoming.map((point) => `${point.bucketMs}:${point.groupId}:${point.vehicleId}`));
  const merged = existing
    .filter((point) => !replacementKeys.has(`${point.bucketMs}:${point.groupId}:${point.vehicleId}`))
    .concat(incoming)
    .sort((a, b) => a.bucketMs - b.bucketMs || a.vehicleId - b.vehicleId);

  const newest = merged[merged.length - 1]?.bucketMs ?? bucketMs;
  const cutoff = newest - DEFAULT_TRAIL_MINUTES * 60_000;
  const inWindow = merged.filter((point) => point.bucketMs >= cutoff);
  CACHE[snapshot.serverId] = inWindow.length > HARD_MAX_POINTS_PER_SERVER
    ? inWindow.slice(inWindow.length - HARD_MAX_POINTS_PER_SERVER)
    : inWindow;
}

export function getLivePositionHistory(serverId: string, minutes = DEFAULT_TRAIL_MINUTES) {
  const rows = CACHE[serverId] ?? [];
  if (rows.length === 0) return [];
  const boundedMinutes = Math.max(1, Math.min(120, minutes));
  const newest = rows[rows.length - 1].bucketMs;
  const cutoff = newest - boundedMinutes * 60_000;
  return rows.filter((point) => point.bucketMs >= cutoff).map((point) => ({ ...point }));
}

export function clearLivePositionHistory(serverId?: string) {
  if (serverId) {
    delete CACHE[serverId];
    return;
  }
  for (const key of Object.keys(CACHE)) delete CACHE[key];
}

export const livePositionHistoryInternals = {
  POSITION_BUCKET_MS,
  DEFAULT_TRAIL_MINUTES,
  HARD_MAX_POINTS_PER_SERVER,
};
