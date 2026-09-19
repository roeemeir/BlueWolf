import type { LiveRuntimeSnapshot } from "./live-runtime";

export const LIVE_RUNTIME_HISTORY_SCHEMA_VERSION = "bluewolf.live-runtime-history.v1" as const;

const DEFAULT_HISTORY_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_HISTORY_LIMIT = 2000;
const MAX_HISTORY_LIMIT = 5000;

export type LiveRuntimeHistoryEvent = {
  id: string;
  active: boolean;
};

export type LiveRuntimeHistoryGroup = {
  id: string;
  name: string;
  color: string;
  total: number;
  sync: number;
  route: number;
  scoreValid: boolean;
  event?: LiveRuntimeHistoryEvent;
};

export type LiveRuntimeHistoryPoint = {
  schemaVersion: typeof LIVE_RUNTIME_HISTORY_SCHEMA_VERSION;
  serverId: string;
  observedAt: string;
  groups: LiveRuntimeHistoryGroup[];
};

const RUNTIME_HISTORY: Record<string, LiveRuntimeHistoryPoint[] | undefined> = {};

function validateLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new Error(`history limit must be an integer in [1,${MAX_HISTORY_LIMIT}]`);
  }
}

function finiteScore(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be finite and in [0,100]`);
  }
  return value;
}

function normalizeEvent(value: unknown): LiveRuntimeHistoryEvent | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object") throw new Error("history event must be an object");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) throw new Error("history event id is missing");
  if (typeof row.active !== "boolean") throw new Error("history event active must be boolean");
  return { id: row.id, active: row.active };
}

function normalizeGroup(value: unknown): LiveRuntimeHistoryGroup {
  if (!value || typeof value !== "object") throw new Error("history group must be an object");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) throw new Error("history group id is missing");
  if (typeof row.name !== "string" || !row.name) throw new Error("history group name is missing");
  if (typeof row.color !== "string" || !row.color) throw new Error("history group color is missing");
  if (typeof row.scoreValid !== "boolean") throw new Error("history group scoreValid must be boolean");
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    total: finiteScore(row.total, "history total"),
    sync: finiteScore(row.sync, "history sync"),
    route: finiteScore(row.route, "history route"),
    scoreValid: row.scoreValid,
    event: normalizeEvent(row.event),
  };
}

function normalizePoint(value: unknown, requestedServerId: string): LiveRuntimeHistoryPoint {
  if (!value || typeof value !== "object") throw new Error("history point must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== LIVE_RUNTIME_HISTORY_SCHEMA_VERSION) throw new Error("unsupported live runtime history schema");
  if (row.serverId !== requestedServerId) throw new Error("runtime history serverId does not match request");
  if (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) {
    throw new Error("runtime history observedAt is invalid");
  }
  if (!Array.isArray(row.groups)) throw new Error("runtime history groups must be an array");
  return {
    schemaVersion: LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
    serverId: requestedServerId,
    observedAt: row.observedAt,
    groups: row.groups.map(normalizeGroup),
  };
}

function pointFromSnapshot(snapshot: LiveRuntimeSnapshot): LiveRuntimeHistoryPoint {
  const groups = snapshot.groupList ?? Object.values(snapshot.groups).filter((group) => Boolean(group));
  return {
    schemaVersion: LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
    serverId: snapshot.serverId,
    observedAt: snapshot.observedAt,
    groups: groups.map((group) => ({
      id: group!.id,
      name: group!.name,
      color: group!.color,
      total: group!.total,
      sync: group!.sync,
      route: group!.route,
      scoreValid: group!.scoreValid,
      event: group!.event ? { id: group!.event.id, active: group!.event.active } : undefined,
    })),
  };
}

function normalizedHistory(
  serverId: string,
  points: LiveRuntimeHistoryPoint[],
  limit: number,
  windowMs = DEFAULT_HISTORY_WINDOW_MS,
) {
  validateLimit(limit);
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("history window must be positive");
  const byObservedAt = new Map<string, LiveRuntimeHistoryPoint>();
  for (const point of points) {
    if (point.serverId !== serverId) throw new Error("runtime history contains a different serverId");
    byObservedAt.set(point.observedAt, structuredClone(point));
  }
  const ordered = [...byObservedAt.values()].sort(
    (first, second) => Date.parse(first.observedAt) - Date.parse(second.observedAt),
  );
  if (ordered.length === 0) return ordered;
  const cutoff = Date.parse(ordered.at(-1)!.observedAt) - windowMs;
  return ordered.filter((point) => Date.parse(point.observedAt) >= cutoff).slice(-limit);
}

export function normalizeLiveRuntimeHistoryPayload(
  value: unknown,
  requestedServerId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): LiveRuntimeHistoryPoint[] {
  validateLimit(limit);
  if (!value || typeof value !== "object") throw new Error("runtime history payload must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== LIVE_RUNTIME_HISTORY_SCHEMA_VERSION) throw new Error("unsupported live runtime history schema");
  if (row.serverId !== requestedServerId) throw new Error("runtime history serverId does not match request");
  if (!Array.isArray(row.points)) throw new Error("runtime history points must be an array");
  return normalizedHistory(
    requestedServerId,
    row.points.map((item) => normalizePoint(item, requestedServerId)),
    limit,
  );
}

export function applyLiveRuntimeHistory(
  serverId: string,
  points: LiveRuntimeHistoryPoint[],
  limit = DEFAULT_HISTORY_LIMIT,
) {
  const current = RUNTIME_HISTORY[serverId] ?? [];
  RUNTIME_HISTORY[serverId] = normalizedHistory(serverId, [...current, ...points], limit);
}

export function appendLiveRuntimeHistory(
  snapshot: LiveRuntimeSnapshot,
  limit = DEFAULT_HISTORY_LIMIT,
) {
  if (snapshot.source.kind !== "python-core" || snapshot.source.health === "unavailable") return;
  const current = RUNTIME_HISTORY[snapshot.serverId] ?? [];
  RUNTIME_HISTORY[snapshot.serverId] = normalizedHistory(
    snapshot.serverId,
    [...current, pointFromSnapshot(snapshot)],
    limit,
  );
}

export function getLiveRuntimeHistory(serverId: string): LiveRuntimeHistoryPoint[] {
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
): Promise<LiveRuntimeHistoryPoint[]> {
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
export const LIVE_RUNTIME_HISTORY_WINDOW_MS = DEFAULT_HISTORY_WINDOW_MS;
