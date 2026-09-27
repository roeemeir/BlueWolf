import { mergeScoreTrace, type ScoreTracePoint } from "./score-trace";
import { normalizeTestNavigationProvenance, type TestNavigationProvenance } from "./runtime-navigation-provenance";
import {
  SERVER_SCENARIOS,
  type DemoGroup,
  type DemoGroupKey,
  type DemoVehicle,
  type Family,
  type ServerScenario,
} from "./bluewolf";

export const LIVE_RUNTIME_SCHEMA_VERSION = "bluewolf.live-runtime.v1" as const;

export type RuntimeHealth = "healthy" | "stale" | "unavailable";
export type RuntimeSourceKind = "simulation" | "python-core";

export type LiveRuntimeAlert = {
  id: string;
  title: string;
  detail: string;
  severity: "warning" | "critical";
  activeSince?: string;
};

export type LiveRuntimeRecommendation = {
  templateId: string;
  activeTemplateId: string;
  dimension: "sync" | "total";
  improvementPoints: number;
  sustainedSeconds?: number;
  ready: boolean;
};

export type LiveRuntimeEvent = {
  id: string;
  contextKey: string;
  startedAt: string;
  active: boolean;
};

export type LiveRuntimeRoutePoint = { latitude: number; longitude: number };
export type LiveRuntimeDetectedRoute = {
  routeInstanceId: string;
  routeId: string;
  family: string;
  subtype: string;
  topology: string;
  direction: string;
  detectionQuality: number;
  centerline: LiveRuntimeRoutePoint[];
};

export type LiveRuntimeVehicle = DemoVehicle & {
  scoreValid: boolean;
  reasons?: string[];
  latitude?: number;
  longitude?: number;
  headingDeg?: number;
  speedMps?: number;
};

export type LiveRuntimeGroup = Omit<DemoGroup, "members" | "alert"> & {
  members: LiveRuntimeVehicle[];
  scoreValid: boolean;
  observedAt: string;
  // rawTotal comes from the SAME selected-template Core scoring pass. total
  // remains the checkpointed ten-second event/alert score, never UI feedback.
  rawTotal?: number;
  detectedRoutes?: LiveRuntimeDetectedRoute[];
  alert?: LiveRuntimeAlert;
  event?: LiveRuntimeEvent;
  recommendation?: LiveRuntimeRecommendation;
};

export type LiveRuntimeSnapshot = {
  schemaVersion: typeof LIVE_RUNTIME_SCHEMA_VERSION;
  serverId: string;
  arena: string;
  status: string;
  observedAt: string;
  source: {
    kind: RuntimeSourceKind;
    health: RuntimeHealth;
    detail?: string;
  } & Partial<TestNavigationProvenance>;
  groups: Partial<Record<DemoGroupKey, LiveRuntimeGroup>>;
  groupList?: LiveRuntimeGroup[];
};

const SIMULATION_BASELINES: Record<string, ServerScenario> = structuredClone(SERVER_SCENARIOS);
const RUNTIME_TRACES: Record<string, ScoreTracePoint[]> = {};
export const getRuntimeTrace = (serverId: string, horizonMinutes = 30): ScoreTracePoint[] => {
  const source = RUNTIME_TRACES[serverId] ?? [];
  if (!Number.isFinite(horizonMinutes) || horizonMinutes <= 0) return [];
  const end = source.at(-1)?.timeMs ?? 0;
  return source.filter((point) => point.timeMs >= end - horizonMinutes * 60_000);
};

const RUNTIME_GROUP_LISTS: Record<string, LiveRuntimeGroup[] | undefined> = {};

function baselineScenario(serverId: string): ServerScenario {
  return structuredClone(SIMULATION_BASELINES[serverId] ?? SIMULATION_BASELINES["1"]);
}

function asRuntimeVehicle(vehicle: DemoVehicle, scoreValid = true): LiveRuntimeVehicle {
  return { ...vehicle, scoreValid };
}

function asRuntimeGroup(group: DemoGroup, observedAt: string, scoreValid = true): LiveRuntimeGroup {
  const alert = group.alert ? { id: `${group.id}:simulation-alert`, ...group.alert } satisfies LiveRuntimeAlert : undefined;
  return {
    ...group,
    alert,
    members: group.members.map((member) => asRuntimeVehicle(member, scoreValid)),
    scoreValid,
    observedAt,
  };
}

function unavailableGroup(group: DemoGroup, observedAt: string, reason: string): LiveRuntimeGroup {
  return {
    ...asRuntimeGroup(group, observedAt, false),
    total: 0,
    sync: 0,
    route: 0,
    confidence: 0,
    reason,
    success: "אין ציון מבצעי תקף עד לחזרת ה-runtime.",
    alert: undefined,
    members: group.members.map((member) => ({
      ...member,
      score: 0,
      sync: 0,
      route: 0,
      confidence: 0,
      scoreValid: false,
      reasons: [reason],
    })),
  };
}

export function simulationRuntimeSnapshot(serverId: string, observedAt = new Date().toISOString()): LiveRuntimeSnapshot {
  const scenario = baselineScenario(serverId);
  const si = asRuntimeGroup(scenario.groups.si, observedAt);
  const so = asRuntimeGroup(scenario.groups.so, observedAt);
  return {
    schemaVersion: LIVE_RUNTIME_SCHEMA_VERSION,
    serverId,
    arena: scenario.arena,
    status: scenario.status,
    observedAt,
    source: { kind: "simulation", health: "healthy", detail: "deterministic UI simulation" },
    groups: { si, so },
    groupList: [si, so],
  };
}

export function unavailableRuntimeSnapshot(serverId: string, detail: string, observedAt = new Date().toISOString()): LiveRuntimeSnapshot {
  const scenario = baselineScenario(serverId);
  const si = unavailableGroup(scenario.groups.si, observedAt, "Python Core לא סיפק snapshot תקף לקבוצת SI.");
  const so = unavailableGroup(scenario.groups.so, observedAt, "Python Core לא סיפק snapshot תקף לקבוצת SO.");
  return {
    schemaVersion: LIVE_RUNTIME_SCHEMA_VERSION,
    serverId,
    arena: scenario.arena,
    status: "CORE RUNTIME UNAVAILABLE",
    observedAt,
    source: { kind: "python-core", health: "unavailable", detail },
    groups: { si, so },
    groupList: [si, so],
  };
}

function isFiniteScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isGroupKey(value: unknown): value is DemoGroupKey {
  return value === "si" || value === "so";
}

function groupKeyFromValue(value: unknown): DemoGroupKey | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (isGroupKey(row.key)) return row.key;
  if (row.family === "SI") return "si";
  if (row.family === "SO") return "so";
  return null;
}

function normalizeDetectedRoutes(value: unknown): LiveRuntimeDetectedRoute[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("runtime detectedRoutes must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("runtime detected route must be an object");
    const row = raw as Record<string, unknown>;
    if (typeof row.routeInstanceId !== "string" || !row.routeInstanceId || ids.has(row.routeInstanceId)) throw new Error("runtime route instance id must be unique and non-empty");
    ids.add(row.routeInstanceId);
    if (typeof row.routeId !== "string" || !row.routeId) throw new Error("runtime route id is required");
    for (const field of ["family", "subtype", "topology", "direction"] as const) if (typeof row[field] !== "string" || !row[field]) throw new Error(`runtime route ${field} is required`);
    if (typeof row.detectionQuality !== "number" || !Number.isFinite(row.detectionQuality) || row.detectionQuality < 0 || row.detectionQuality > 1) throw new Error("runtime route detectionQuality must be in [0,1]");
    if (!Array.isArray(row.centerline) || row.centerline.length < 3) throw new Error("runtime route centerline requires at least three points");
    const centerline = row.centerline.map((point) => {
      if (!point || typeof point !== "object") throw new Error("runtime route point must be an object");
      const item = point as Record<string, unknown>;
      if (typeof item.latitude !== "number" || !Number.isFinite(item.latitude) || item.latitude < -90 || item.latitude > 90) throw new Error("runtime route latitude is invalid");
      if (typeof item.longitude !== "number" || !Number.isFinite(item.longitude) || item.longitude < -180 || item.longitude > 180) throw new Error("runtime route longitude is invalid");
      return { latitude: item.latitude, longitude: item.longitude };
    });
    return {
      routeInstanceId: row.routeInstanceId,
      routeId: row.routeId,
      family: row.family as string,
      subtype: row.subtype as string,
      topology: row.topology as string,
      direction: row.direction as string,
      detectionQuality: row.detectionQuality,
      centerline,
    };
  });
}

function normalizeVehicle(value: unknown): LiveRuntimeVehicle | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "number" || typeof row.typeId !== "string") return null;
  if (![row.score, row.sync, row.route, row.confidence].every(isFiniteScore)) return null;
  if (typeof row.phase !== "number" || !Number.isFinite(row.phase)) return null;

  const hasLatitude = row.latitude !== undefined;
  const hasLongitude = row.longitude !== undefined;
  if (hasLatitude !== hasLongitude) return null;
  let latitude: number | undefined;
  let longitude: number | undefined;
  if (hasLatitude && hasLongitude) {
    if (typeof row.latitude !== "number" || !Number.isFinite(row.latitude) || row.latitude < -90 || row.latitude > 90) return null;
    if (typeof row.longitude !== "number" || !Number.isFinite(row.longitude) || row.longitude < -180 || row.longitude > 180) return null;
    latitude = row.latitude;
    longitude = row.longitude;
  }
  let headingDeg: number | undefined;
  if (row.headingDeg !== undefined) {
    if (typeof row.headingDeg !== "number" || !Number.isFinite(row.headingDeg)) return null;
    headingDeg = ((row.headingDeg % 360) + 360) % 360;
  }
  let speedMps: number | undefined;
  if (row.speedMps !== undefined) {
    if (typeof row.speedMps !== "number" || !Number.isFinite(row.speedMps) || row.speedMps < 0) return null;
    speedMps = row.speedMps;
  }
  return {
    id: row.id,
    typeId: row.typeId,
    score: row.score as number,
    sync: row.sync as number,
    route: row.route as number,
    confidence: row.confidence as number,
    phase: row.phase,
    ring: row.ring === "inner" || row.ring === "middle" || row.ring === "outer" ? row.ring : undefined,
    scoreValid: row.scoreValid !== false,
    reasons: Array.isArray(row.reasons) ? row.reasons.filter((item): item is string => typeof item === "string") : undefined,
    latitude,
    longitude,
    headingDeg,
    speedMps,
  };
}

function normalizeGroup(value: unknown, key: DemoGroupKey, observedAt: string): LiveRuntimeGroup | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const family: Family = row.family === "SI" || row.family === "SO" ? row.family : key === "si" ? "SI" : "SO";
  if (typeof row.id !== "string" || typeof row.templateId !== "string") return null;
  if (![row.total, row.sync, row.route, row.confidence].every(isFiniteScore)) return null;
  // A malformed raw score is never replaced by the already-smoothed total.
  if (row.rawTotal !== undefined && (!isFiniteScore(row.rawTotal) || row.scoreValid === false)) return null;
  const members = Array.isArray(row.members) ? row.members.map(normalizeVehicle) : [];
  if (members.some((member) => member === null)) return null;
  const detectedRoutes = normalizeDetectedRoutes(row.detectedRoutes);
  const alertValue = row.alert && typeof row.alert === "object" ? row.alert as Record<string, unknown> : null;
  const alert = alertValue && typeof alertValue.title === "string" && typeof alertValue.detail === "string" && (alertValue.severity === "warning" || alertValue.severity === "critical")
    ? {
        id: typeof alertValue.id === "string" ? alertValue.id : `${row.id}:alert`,
        title: alertValue.title,
        detail: alertValue.detail,
        severity: alertValue.severity,
        activeSince: typeof alertValue.activeSince === "string" ? alertValue.activeSince : undefined,
      } satisfies LiveRuntimeAlert
    : undefined;
  const recommendationValue = row.recommendation && typeof row.recommendation === "object" ? row.recommendation as Record<string, unknown> : null;
  const recommendation = recommendationValue
    && typeof recommendationValue.templateId === "string"
    && typeof recommendationValue.activeTemplateId === "string"
    && (recommendationValue.dimension === "sync" || recommendationValue.dimension === "total")
    && typeof recommendationValue.improvementPoints === "number"
    ? {
        templateId: recommendationValue.templateId,
        activeTemplateId: recommendationValue.activeTemplateId,
        dimension: recommendationValue.dimension,
        improvementPoints: recommendationValue.improvementPoints,
        sustainedSeconds: typeof recommendationValue.sustainedSeconds === "number" ? recommendationValue.sustainedSeconds : undefined,
        ready: recommendationValue.ready === true,
      } satisfies LiveRuntimeRecommendation
    : undefined;
  const eventValue = row.event && typeof row.event === "object" ? row.event as Record<string, unknown> : null;
  const event = eventValue
    && typeof eventValue.id === "string"
    && typeof eventValue.contextKey === "string"
    && typeof eventValue.startedAt === "string"
    ? {
        id: eventValue.id,
        contextKey: eventValue.contextKey,
        startedAt: eventValue.startedAt,
        active: eventValue.active !== false,
      } satisfies LiveRuntimeEvent
    : undefined;
  return {
    key,
    id: row.id,
    name: typeof row.name === "string" ? row.name : `קבוצה ${row.id}`,
    family,
    subtitle: typeof row.subtitle === "string" ? row.subtitle : family === "SO" ? "Runtime SO" : "Runtime SI",
    total: row.total as number,
    rawTotal: row.rawTotal as number | undefined,
    sync: row.sync as number,
    route: row.route as number,
    confidence: row.confidence as number,
    color: typeof row.color === "string" ? row.color : key === "so" ? "#4378e8" : "#20b9a8",
    members: members as LiveRuntimeVehicle[],
    templateId: row.templateId,
    reason: typeof row.reason === "string" ? row.reason : "Python Core runtime",
    success: typeof row.success === "string" ? row.success : "",
    scoreValid: row.scoreValid !== false,
    observedAt: typeof row.observedAt === "string" ? row.observedAt : observedAt,
    detectedRoutes,
    alert,
    recommendation,
    event,
  };
}

function normalizeGroupList(value: unknown, observedAt: string): LiveRuntimeGroup[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("runtime groupList must be an array");
  const output: LiveRuntimeGroup[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const key = groupKeyFromValue(item);
    if (key === null) throw new Error("runtime groupList item has no valid family/key");
    const normalized = normalizeGroup(item, key, observedAt);
    if (!normalized) throw new Error("invalid runtime groupList item");
    if (ids.has(normalized.id)) throw new Error(`duplicate runtime group id: ${normalized.id}`);
    ids.add(normalized.id);
    output.push(normalized);
  }
  return output;
}

export function normalizeLiveRuntimeSnapshot(value: unknown, requestedServerId?: string): LiveRuntimeSnapshot {
  if (!value || typeof value !== "object") throw new Error("runtime payload must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== LIVE_RUNTIME_SCHEMA_VERSION) throw new Error("unsupported live runtime schema");
  if (typeof row.serverId !== "string") throw new Error("runtime serverId is missing");
  if (requestedServerId && row.serverId !== requestedServerId) throw new Error("runtime serverId does not match request");
  if (typeof row.observedAt !== "string") throw new Error("runtime observedAt is missing");
  const sourceValue = row.source && typeof row.source === "object" ? row.source as Record<string, unknown> : null;
  if (!sourceValue || sourceValue.kind !== "python-core") throw new Error("runtime source must be python-core");
  const provenance = normalizeTestNavigationProvenance(sourceValue);
  const health: RuntimeHealth = sourceValue.health === "healthy" || sourceValue.health === "stale" || sourceValue.health === "unavailable" ? sourceValue.health : "unavailable";
  const groupsValue = row.groups && typeof row.groups === "object" ? row.groups as Record<string, unknown> : {};
  const groups: Partial<Record<DemoGroupKey, LiveRuntimeGroup>> = {};
  for (const [key, group] of Object.entries(groupsValue)) {
    if (!isGroupKey(key)) continue;
    const normalized = normalizeGroup(group, key, row.observedAt);
    if (!normalized) throw new Error(`invalid runtime group: ${key}`);
    groups[key] = normalized;
  }
  const groupList = normalizeGroupList(row.groupList, row.observedAt)
    ?? Object.values(groups).filter((group): group is LiveRuntimeGroup => Boolean(group));
  return {
    schemaVersion: LIVE_RUNTIME_SCHEMA_VERSION,
    serverId: row.serverId,
    arena: typeof row.arena === "string" ? row.arena : baselineScenario(row.serverId).arena,
    status: typeof row.status === "string" ? row.status : `${groupList.length} קבוצות runtime`,
    observedAt: row.observedAt,
    source: {
      kind: "python-core",
      health,
      detail: typeof sourceValue.detail === "string" ? sourceValue.detail : undefined,
      ...provenance,
    },
    groups,
    groupList,
  };
}

export function scenarioFromRuntimeSnapshot(snapshot: LiveRuntimeSnapshot): ServerScenario {
  const baseline = baselineScenario(snapshot.serverId);
  const missingReason = snapshot.source.health === "healthy"
    ? "Python Core לא סיפק snapshot לקבוצה זו."
    : snapshot.source.detail ?? "Python Core runtime אינו זמין.";
  const listed = snapshot.groupList ?? [];
  const si = listed.find((group) => group.key === "si") ?? snapshot.groups.si ?? unavailableGroup(baseline.groups.si, snapshot.observedAt, missingReason);
  const so = listed.find((group) => group.key === "so") ?? snapshot.groups.so ?? unavailableGroup(baseline.groups.so, snapshot.observedAt, missingReason);
  return {
    id: snapshot.serverId,
    arena: snapshot.arena,
    status: snapshot.status,
    groups: { si, so },
  };
}

export function applyLiveRuntimeSnapshot(snapshot: LiveRuntimeSnapshot) {
  // A transport/health failure contains NO observed navigation frame. Do not
  // pass an artificial, positionless fallback into mergeScoreTrace: doing so
  // would mark the last genuine fix as a source-observed GPS outage. A healthy
  // Core snapshot with missing coordinates still takes the normal gap path.
  if (snapshot.source.health === "healthy") {
    const incoming = (snapshot.groupList ?? Object.values(snapshot.groups).filter((g): g is LiveRuntimeGroup => Boolean(g))).flatMap(group => group.members.flatMap(vehicle => vehicle.latitude === undefined || vehicle.longitude === undefined ? [] : [{ timeMs: Date.parse(group.observedAt), groupId: group.id, eventId: group.event?.id ?? group.id, vehicleId: vehicle.id, latitude: vehicle.latitude, longitude: vehicle.longitude, sync: vehicle.scoreValid ? vehicle.sync : null }]));
    RUNTIME_TRACES[snapshot.serverId] = mergeScoreTrace(RUNTIME_TRACES[snapshot.serverId] ?? [], incoming, 2 * 60 * 60_000);
  }

  SERVER_SCENARIOS[snapshot.serverId] = scenarioFromRuntimeSnapshot(snapshot);
  RUNTIME_GROUP_LISTS[snapshot.serverId] = structuredClone(
    snapshot.groupList ?? Object.values(snapshot.groups).filter((group): group is LiveRuntimeGroup => Boolean(group)),
  );
}

export function getRuntimeGroups(serverId: string): LiveRuntimeGroup[] {
  const runtime = RUNTIME_GROUP_LISTS[serverId];
  if (runtime && runtime.length > 0) return structuredClone(runtime);
  const scenario = SERVER_SCENARIOS[serverId] ?? baselineScenario(serverId);
  const observedAt = new Date().toISOString();
  return Object.values(scenario.groups).map((group) => asRuntimeGroup(group, observedAt));
}

export function restoreSimulationScenario(serverId: string) {
  SERVER_SCENARIOS[serverId] = baselineScenario(serverId);
  delete RUNTIME_GROUP_LISTS[serverId];
  delete RUNTIME_TRACES[serverId];
}

export async function fetchLiveRuntimeSnapshot(serverId: string, fetcher: typeof fetch = fetch): Promise<LiveRuntimeSnapshot> {
  const response = await fetcher(`/api/live-runtime?serverId=${encodeURIComponent(serverId)}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    let detail = `runtime request failed (${response.status})`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) detail = payload.error;
    } catch {
      // Keep the status-based detail when the upstream did not return JSON.
    }
    throw new Error(detail);
  }
  return normalizeLiveRuntimeSnapshot(await response.json(), serverId);
}
