import {
  LIVE_RUNTIME_SCHEMA_VERSION,
  normalizeLiveRuntimeSnapshot,
  type LiveRuntimeSnapshot,
} from "./live-runtime";

const DEFAULT_HISTORY_LIMIT = 360;
const MAX_HISTORY_LIMIT = 1000;
const RUNTIME_HISTORY: Record<string, LiveRuntimeSnapshot[] | undefined> = {};

function validateLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new Error(`history limit must be an integer in [1,${MAX_HISTORY_LIMIT}]`);
  }
}

function normalizedHistory(serverId: string, snapshots: LiveRuntimeSnapshot[], limit: number) {
  validateLimit(limit);
  const byObservedAt = new Map<string, LiveRuntimeSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.serverId !== serverId) throw new Error("runtime history contains a different serverId");
    if (snapshot.source.kind !== "python-core") throw new Error("runtime history source must be python-core");
    byObservedAt.set(snapshot.observedAt, structuredClone(snapshot));
  }
  return [...byObservedAt.values()]
    .sort((first, second) => Date.parse(first.observedAt) - Date.parse(second.observedAt))
    .slice(-limit);
}

export function normalizeLiveRuntimeHistoryPayload(
  value: unknown,
  requestedServerId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): LiveRuntimeSnapshot[] {
  validateLimit(limit);
  if (!value || typeof value !== "object") throw new Error("runtime history payload must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== LIVE_RUNTIME_SCHEMA_VERSION) throw new Error("unsupported live runtime history schema");
  if (row.serverId !== requestedServerId) throw new Error("runtime history serverId does not match request");
  if (!Array.isArray(row.snapshots)) throw new Error("runtime history snapshots must be an array");
  const snapshots = row.snapshots.map((item) => normalizeLiveRuntimeSnapshot(item, requestedServerId));
  return normalizedHistory(requestedServerId, snapshots, limit);
}

export function applyLiveRuntimeHistory(
  serverId: string,
  snapshots: LiveRuntimeSnapshot[],
  limit = DEFAULT_HISTORY_LIMIT,
) {
  RUNTIME_HISTORY[serverId] = normalizedHistory(serverId, snapshots, limit);
}

export function appendLiveRuntimeHistory(
  snapshot: LiveRuntimeSnapshot,
  limit = DEFAULT_HISTORY_LIMIT,
) {
  if (snapshot.source.kind !== "python-core" || snapshot.source.health === "unavailable") return;
  const current = RUNTIME_HISTORY[snapshot.serverId] ?? [];
  RUNTIME_HISTORY[snapshot.serverId] = normalizedHistory(
    snapshot.serverId,
    [...current, snapshot],
    limit,
  );
}

export function getLiveRuntimeHistory(serverId: string): LiveRuntimeSnapshot[] {
  return structuredClone(RUNTIME_HISTORY[serverId] ?? []);
}

export function clearLiveRuntimeHistory(serverId?: string) {
  if (serverId) delete RUNTIME_HISTORY[serverId];
  else for (const key of Object.keys(RUNTIME_HISTORY)) delete RUNTIME_HISTORY[key];
}

export async function fetchLiveRuntimeHistory(
  serverId: string,
  limit = DEFAULT_HISTORY_LIMIT,
  fetcher: typeof fetch = fetch,
): Promise<LiveRuntimeSnapshot[]> {
  validateLimit(limit);
  const response = await fetcher(
    `/api/live-runtime/history?serverId=${encodeURIComponent(serverId)}&limit=${limit}`,
    { cache: "no-store", headers: { accept: "application/json" } },
  );
  if (!response.ok) {
    let detail = `runtime history request failed (${response.status})`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) detail = payload.error;
    } catch {
      // Keep the status-based detail when the upstream did not return JSON.
    }
    throw new Error(detail);
  }
  return normalizeLiveRuntimeHistoryPayload(await response.json(), serverId, limit);
}

export const LIVE_RUNTIME_HISTORY_LIMIT = DEFAULT_HISTORY_LIMIT;
