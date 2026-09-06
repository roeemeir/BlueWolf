import { pointOnClosed } from "../v09/geometry";
import { getV09Scenario } from "../v09/simulator";
import { windOffsetPx, type WindMode } from "../v10/wind";
import type { SoGroupingSettings } from "../v10/grouping";

export type NavigationSource = "simulation" | "influx";
export type NavigationRouteKind = "circle" | "single" | "double" | "figure8";

export type RawNavigationSample = {
  source: NavigationSource;
  serverId: string;
  timestamp: string;
  vehicleId: number;
  active: boolean;
  latitude: number;
  longitude: number;
  altitude: number | null;
  velocityNorth: number;
  velocityEast: number;
  /** Local metric EN coordinates. x=east metres, y=north metres. */
  x: number;
  y: number;
};

export type NavigationProvenance = {
  source: NavigationSource;
  serverId: string;
  from: string;
  to: string;
  latestSampleAt: string | null;
  sampleCount: number;
  vehicleCount: number;
  samplingMedianSeconds: number | null;
  completenessPct: number | null;
  freshnessSeconds: number | null;
  warnings: string[];
};

export type NavigationDataset = { samples: RawNavigationSample[]; provenance: NavigationProvenance };

export type SimulatorGroundTruth = {
  timestamp: string; serverId: string; activeVehicles: number[]; siVehicles: number[]; soVehicles: number[]; ungroupedVehicles: number[];
  routeKinds: Record<number, NavigationRouteKind>; routeKeys: Record<number, string>;
};

export const SIMULATION_HISTORY_DAYS = 30;
const SIM_ORIGIN_LAT = 31.7045;
const SIM_ORIGIN_LON = 34.8435;
const METRES_PER_DEG_LAT = 111_320;
const METRES_PER_DEG_LON = METRES_PER_DEG_LAT * Math.cos(SIM_ORIGIN_LAT * Math.PI / 180);

export function simulationHistoryBounds(now = new Date()) { return { from: new Date(now.getTime() - SIMULATION_HISTORY_DAYS * 86_400_000), to: now }; }

/** Absolute-time deterministic tick. Same server + timestamp always returns the same scenario. */
export function simulationTickAt(timestamp: Date) {
  const ms = timestamp.getTime(); const day = Math.floor(ms / 86_400_000);
  const secondOfDay = Math.floor((ms % 86_400_000 + 86_400_000) % 86_400_000 / 1000);
  return day * 997 + secondOfDay;
}

function deterministicNoise(serverId: string, tick: number, vehicleId: number) {
  const stress = serverId === "3" ? 3.8 : serverId === "2" ? 2.4 : 1.2; const seed = vehicleId * .071 + Number(serverId) * 1.9;
  return { x: stress * Math.sin(tick / 19 + seed), y: stress * .75 * Math.cos(tick / 17 + seed * 1.3) };
}
function displayToMetric(displayX: number, displayY: number) { return { x: displayX - 500, y: 285 - displayY }; }
function metricToGeo(x: number, y: number) { return { latitude: SIM_ORIGIN_LAT + y / METRES_PER_DEG_LAT, longitude: SIM_ORIGIN_LON + x / METRES_PER_DEG_LON }; }

function snapshotLocal(serverId: string, timestamp: Date, grouping: SoGroupingSettings, windMode: WindMode) {
  const tick = simulationTickAt(timestamp); const scenario = getV09Scenario(serverId, tick, grouping);
  const members = [...scenario.groups.si.members, ...scenario.groups.so.members, ...(scenario.ungroupedMembers ?? [])];
  const points = new Map<number, { x: number; y: number; routeKey: string; kind: NavigationRouteKind }>();
  for (const member of members) {
    const route = scenario.routes.find((item) => item.key === member.routeKey); if (!route) continue;
    const ideal = pointOnClosed(route.points, member.phase); const noise = deterministicNoise(serverId, tick, member.id); const wind = windOffsetPx(serverId, tick, member.id, windMode);
    const metric = displayToMetric(ideal.x + noise.x + wind.x, ideal.y + noise.y + wind.y);
    points.set(member.id, { x: metric.x, y: metric.y, routeKey: route.key, kind: route.kind });
  }
  return { scenario, points, tick };
}

function sampleAt(serverId: string, timestamp: Date, grouping: SoGroupingSettings, windMode: WindMode) {
  const current = snapshotLocal(serverId, timestamp, grouping, windMode); const previousTime = new Date(timestamp.getTime() - 2_000); const previous = snapshotLocal(serverId, previousTime, grouping, windMode);
  const out: RawNavigationSample[] = [];
  for (const [vehicleId, point] of current.points) {
    const prev = previous.points.get(vehicleId) ?? point; const velocityEast = (point.x - prev.x) / 2; const velocityNorth = (point.y - prev.y) / 2; const geo = metricToGeo(point.x, point.y);
    out.push({ source: "simulation", serverId, timestamp: timestamp.toISOString(), vehicleId, active: true, latitude: geo.latitude, longitude: geo.longitude, altitude: 35 + (vehicleId % 7) * 1.5, velocityNorth, velocityEast, x: point.x, y: point.y });
  }
  return out;
}

export function simulatorGroundTruthAt(serverId: string, timestamp: Date, grouping: SoGroupingSettings): SimulatorGroundTruth {
  const scenario = getV09Scenario(serverId, simulationTickAt(timestamp), grouping); const routeKinds: SimulatorGroundTruth["routeKinds"] = {}; const routeKeys: Record<number, string> = {};
  const all = [...scenario.groups.si.members, ...scenario.groups.so.members, ...(scenario.ungroupedMembers ?? [])];
  for (const member of all) { const route = scenario.routes.find((item) => item.key === member.routeKey); if (route) routeKinds[member.id] = route.kind; routeKeys[member.id] = member.routeKey; }
  return { timestamp: timestamp.toISOString(), serverId, activeVehicles: all.map((item) => item.id).sort((a, b) => a - b), siVehicles: scenario.groups.si.members.map((item) => item.id).sort((a, b) => a - b), soVehicles: scenario.groups.so.members.map((item) => item.id).sort((a, b) => a - b), ungroupedVehicles: (scenario.ungroupedMembers ?? []).map((item) => item.id).sort((a, b) => a - b), routeKinds, routeKeys };
}

function median(values: number[]) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
export function provenanceFromSamples(source: NavigationSource, serverId: string, from: Date, to: Date, samples: RawNavigationSample[], warnings: string[] = []): NavigationProvenance {
  const vehicles = new Set(samples.map((sample) => sample.vehicleId)); const times = [...new Set(samples.map((sample) => new Date(sample.timestamp).getTime()))].sort((a, b) => a - b);
  const gaps = times.slice(1).map((value, index) => (value - times[index]) / 1000).filter((value) => value > 0); const med = median(gaps); const latestMs = times.at(-1) ?? null;
  const expected = med && med > 0 ? Math.max(1, Math.round((to.getTime() - from.getTime()) / 1000 / med) + 1) * Math.max(1, vehicles.size) : null;
  return { source, serverId, from: from.toISOString(), to: to.toISOString(), latestSampleAt: latestMs == null ? null : new Date(latestMs).toISOString(), sampleCount: samples.length, vehicleCount: vehicles.size, samplingMedianSeconds: med, completenessPct: expected ? Math.min(100, samples.length / expected * 100) : null, freshnessSeconds: latestMs == null ? null : Math.max(0, (to.getTime() - latestMs) / 1000), warnings };
}

export function generateSimulationDataset({ serverId, from, to, grouping, windMode = "gusty", targetPoints = 9_000 }: { serverId: string; from: Date; to: Date; grouping: SoGroupingSettings; windMode?: WindMode; targetPoints?: number }): NavigationDataset {
  const bounds = simulationHistoryBounds(to > new Date() ? to : new Date()); const safeFrom = new Date(Math.max(from.getTime(), bounds.from.getTime())); const safeTo = new Date(Math.min(to.getTime(), bounds.to.getTime()));
  if (safeFrom >= safeTo) return { samples: [], provenance: provenanceFromSamples("simulation", serverId, safeFrom, safeTo, [], ["טווח הסימולציה המבוקש ריק או מחוץ ל־30 הימים הזמינים."]) };
  const durationSec = (safeTo.getTime() - safeFrom.getTime()) / 1000; const stepSeconds = Math.max(2, Math.ceil(durationSec * 8 / Math.max(1, targetPoints))); const samples: RawNavigationSample[] = [];
  for (let ms = safeFrom.getTime(); ms <= safeTo.getTime(); ms += stepSeconds * 1000) samples.push(...sampleAt(serverId, new Date(ms), grouping, windMode));
  if (samples.length === 0 || new Date(samples.at(-1)!.timestamp).getTime() < safeTo.getTime() - stepSeconds * 1000) samples.push(...sampleAt(serverId, safeTo, grouping, windMode));
  return { samples, provenance: provenanceFromSamples("simulation", serverId, safeFrom, safeTo, samples, [`סימולציה דטרמיניסטית · צעד דגימה ${stepSeconds}s · היסטוריה זמינה ${SIMULATION_HISTORY_DAYS} ימים.`]) };
}

export function simulationFixtureDataset(serverId: string, center: Date, grouping: SoGroupingSettings, windMode: WindMode = "gusty", minutes = 12) { return generateSimulationDataset({ serverId, from: new Date(center.getTime() - minutes * 60_000), to: center, grouping, windMode, targetPoints: 3_500 }); }
