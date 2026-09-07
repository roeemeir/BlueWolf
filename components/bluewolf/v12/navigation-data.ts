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

export type NavigationDataset = {
  /** Samples visible to the current screen/window. */
  samples: RawNavigationSample[];
  provenance: NavigationProvenance;
  /**
   * Optional longer evidence window used only by the canonical Core. For a
   * 30-minute Operator trail this carries up to 40 minutes of route evidence
   * without forcing the map to display the extra ten minutes.
   */
  coreEvidenceSamples?: RawNavigationSample[];
  coreEvidenceProvenance?: NavigationProvenance;
};

export type SimulatorGroundTruth = {
  timestamp: string; serverId: string; activeVehicles: number[]; siVehicles: number[]; soVehicles: number[]; ungroupedVehicles: number[];
  routeKinds: Record<number, NavigationRouteKind>; routeKeys: Record<number, string>;
};

export type SimulatorInjectedDisturbance = {
  speedKnots: number;
  bearingDeg: number;
  velocityNorth: number;
  velocityEast: number;
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
    const directed = pointOnClosed(route.points, member.phase); const metric = displayToMetric(directed.x, directed.y); const noise = deterministicNoise(serverId, tick, member.id);
    const wind = windOffsetPx(member.id, tick, windMode); points.set(member.id, { x: metric.x + noise.x + wind.x, y: metric.y + noise.y - wind.y, routeKey: route.key, kind: route.kind });
  }
  return { scenario, points };
}

function sampleAt(serverId: string, timestamp: Date, grouping: SoGroupingSettings, windMode: WindMode): RawNavigationSample[] {
  const current = snapshotLocal(serverId, timestamp, grouping, windMode); const next = snapshotLocal(serverId, new Date(timestamp.getTime() + 1000), grouping, windMode); const samples: RawNavigationSample[] = [];
  for (const [vehicleId, point] of current.points) {
    const after = next.points.get(vehicleId) ?? point; const geo = metricToGeo(point.x, point.y);
    samples.push({ source: "simulation", serverId, timestamp: timestamp.toISOString(), vehicleId, active: true, latitude: geo.latitude, longitude: geo.longitude, altitude: 100 + (vehicleId % 17), velocityNorth: after.y - point.y, velocityEast: after.x - point.x, x: point.x, y: point.y });
  }
  return samples;
}

export function provenanceFromSamples(source: NavigationSource, serverId: string, from: Date, to: Date, samples: RawNavigationSample[], warnings: string[] = []): NavigationProvenance {
  const vehicles = new Set(samples.map((sample) => sample.vehicleId)); const times = [...new Set(samples.map((sample) => sample.timestamp))].sort(); const gaps = times.slice(1).map((value, index) => (Date.parse(value) - Date.parse(times[index])) / 1000).filter((value) => value > 0); const sortedGaps = gaps.slice().sort((a,b)=>a-b); const sampling = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length/2)] : null; const latest = times.at(-1) ?? null; const expected = sampling ? Math.max(1, Math.round((to.getTime()-from.getTime())/1000/sampling)+1)*Math.max(1,vehicles.size) : null; const completeness = expected ? Math.min(100, samples.length/expected*100) : null;
  return { source, serverId, from: from.toISOString(), to: to.toISOString(), latestSampleAt: latest, sampleCount: samples.length, vehicleCount: vehicles.size, samplingMedianSeconds: sampling, completenessPct: completeness, freshnessSeconds: latest ? Math.max(0,(to.getTime()-Date.parse(latest))/1000) : null, warnings };
}

export function generateSimulationDataset({ serverId, from, to, grouping, windMode, targetPoints = 4_500 }: { serverId:string; from:Date; to:Date; grouping:SoGroupingSettings; windMode:WindMode; targetPoints?:number }): NavigationDataset {
  const start = from.getTime(), end = to.getTime(); if (end < start) return { samples: [], provenance: provenanceFromSamples("simulation", serverId, from, to, [], ["טווח זמן לא תקין"]) };
  const durationSeconds = Math.max(1, Math.round((end-start)/1000)); const approximateVehicles = serverId === "1" ? 7 : serverId === "2" ? 6 : 8; const maxStepForRouteFidelity = durationSeconds >= 6 * 60 * 60 ? 10 : durationSeconds >= 60 * 60 ? 5 : 2; const idealStep = Math.max(1, Math.ceil(durationSeconds * approximateVehicles / Math.max(300, targetPoints))); const step = Math.max(1, Math.min(maxStepForRouteFidelity, idealStep)); const samples: RawNavigationSample[] = [];
  for (let ms=start; ms<=end; ms+=step*1000) samples.push(...sampleAt(serverId,new Date(ms),grouping,windMode)); if (!samples.length || samples.at(-1)?.timestamp !== new Date(end).toISOString()) samples.push(...sampleAt(serverId,new Date(end),grouping,windMode));
  return { samples, provenance: provenanceFromSamples("simulation",serverId,from,to,samples) };
}

export function simulatorGroundTruthAt(serverId:string,timestamp:Date,grouping:SoGroupingSettings):SimulatorGroundTruth{const scenario=getV09Scenario(serverId,simulationTickAt(timestamp),grouping);const si=scenario.groups.si.members.map((item)=>item.id),so=scenario.groups.so.members.map((item)=>item.id),ungrouped=(scenario.ungroupedMembers??[]).map((item)=>item.id);return{timestamp:timestamp.toISOString(),serverId,activeVehicles:[...si,...so,...ungrouped].sort((a,b)=>a-b),siVehicles:si.sort((a,b)=>a-b),soVehicles:so.sort((a,b)=>a-b),ungroupedVehicles:ungrouped.sort((a,b)=>a-b),routeKinds:Object.fromEntries(scenario.routes.flatMap((route)=>[...scenario.groups.si.members,...scenario.groups.so.members,...(scenario.ungroupedMembers??[])].filter((member)=>member.routeKey===route.key).map((member)=>[member.id,route.kind]))),routeKeys:Object.fromEntries([...scenario.groups.si.members,...scenario.groups.so.members,...(scenario.ungroupedMembers??[])].map((member)=>[member.id,member.routeKey]))};}

export function simulatorInjectedDisturbanceAt(serverId:string,timestamp:Date,vehicleId:number,grouping:SoGroupingSettings,windMode:WindMode):SimulatorInjectedDisturbance|null{const windy=sampleAt(serverId,timestamp,grouping,windMode).find((sample)=>sample.vehicleId===vehicleId),calm=sampleAt(serverId,timestamp,grouping,"off").find((sample)=>sample.vehicleId===vehicleId);if(!windy||!calm)return null;const velocityEast=windy.velocityEast-calm.velocityEast,velocityNorth=windy.velocityNorth-calm.velocityNorth,speedMps=Math.hypot(velocityEast,velocityNorth);return{velocityEast,velocityNorth,speedKnots:speedMps*1.9438444924406,bearingDeg:speedMps<1e-9?0:(Math.atan2(velocityEast,velocityNorth)*180/Math.PI+360)%360};}
