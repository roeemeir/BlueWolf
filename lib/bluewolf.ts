export type Family = "SI" | "SO";
export type Quality = "good" | "medium" | "low" | "transition";
export type DeveloperSection = "score" | "templates" | "gt" | "influx" | "routes" | "tests" | "settings";

export type ScoreWeights = {
  sync: { position: number; period: number; motion: number };
  route: { distance: number; tangent: number; curvature: number };
  total: { sync: number; route: number };
};

export type ScoreThresholds = {
  siPositionFullDeg: number;
  siPositionZeroDeg: number;
  soPositionFullPct: number;
  soPositionZeroPct: number;
  periodFullPct: number;
  periodZeroPct: number;
  motionFullPct: number;
  motionZeroPct: number;
  routeDistanceFullPct: number;
  routeDistanceZeroPct: number;
  tangentFullDeg: number;
  tangentZeroDeg: number;
  curvatureFullPct: number;
  curvatureZeroPct: number;
  lowSpeedPct: number;
  smoothingSeconds: number;
  greenScore: number;
  redScore: number;
};

export type SyncTemplate = {
  id: string;
  family: Family;
  name: string;
  mix: string;
  constellation: string;
  law: string;
  values: number[];
  isDefault: boolean;
  updatedAt: string;
};

export type SavedRoute = {
  id: string;
  name: string;
  arena: string;
  vehicleType: string;
  family: Family;
  geometry: string;
  updatedAt: string;
};

export type InfluxSettings = {
  url: string;
  organization: string;
  bucket: string;
  idleProbeMinutes: number;
  activePollSeconds: number;
  joinToleranceSeconds: number;
  activeOnValue: string;
  mappings: Record<string, string>;
};

export type ServerDefinition = { id: string; name: string; enabled: boolean };
export type VehicleType = { id: string; name: string; minId: number; maxId: number; workSpeedKmh: number; siRoles: string[] };
export type GtSegment = { id: string; family: Family; layer: "sync" | "route"; quality: "good" | "medium" | "low"; label: string };

export type WorkspaceState = {
  weights: ScoreWeights;
  thresholds: ScoreThresholds;
  templates: SyncTemplate[];
  routes: SavedRoute[];
  influx: InfluxSettings;
  servers: ServerDefinition[];
  vehicleTypes: VehicleType[];
  gtSegments: GtSegment[];
  settings: {
    timezone: string;
    retentionDays: number;
    maxSoVehicles: number;
    uiRefreshSeconds: number;
    defaultMap: string;
  };
  investigationEdits: Record<string, { note: string; templateId: string }>;
};

const now = "2026-09-02T19:00:00.000Z";

export const DEFAULT_WORKSPACE: WorkspaceState = {
  weights: {
    sync: { position: 60, period: 20, motion: 20 },
    route: { distance: 15, tangent: 70, curvature: 15 },
    total: { sync: 75, route: 25 },
  },
  thresholds: {
    siPositionFullDeg: 10,
    siPositionZeroDeg: 30,
    soPositionFullPct: 5,
    soPositionZeroPct: 25,
    periodFullPct: 5,
    periodZeroPct: 20,
    motionFullPct: 10,
    motionZeroPct: 30,
    routeDistanceFullPct: 5,
    routeDistanceZeroPct: 30,
    tangentFullDeg: 10,
    tangentZeroDeg: 60,
    curvatureFullPct: 10,
    curvatureZeroPct: 100,
    lowSpeedPct: 30,
    smoothingSeconds: 10,
    greenScore: 80,
    redScore: 50,
  },
  templates: [
    { id: "tpl-si-120", family: "SI", name: "SI · סער פנימי, ברק ביניים, רעם חיצוני · 120°", mix: "סער×1 · ברק×1 · רעם×1", constellation: "פנימי → ביניים → חיצוני", law: "הפרשי זווית", values: [120, 120], isDefault: true, updatedAt: now },
    { id: "tpl-so-opposite", family: "SO", name: "SO · סער×2 + ברק באמצע · הפוך", mix: "סער×2 · ברק×1", constellation: "סער — ברק — סער", law: "רבע נגדי + פניות יחד", values: [2, 2], isDefault: true, updatedAt: now },
    { id: "tpl-so-side", family: "SO", name: "SO · סער×2 + ברק בצד · הפוך", mix: "סער×2 · ברק×1", constellation: "ברק — סער — סער", law: "רבע נגדי + פניות יחד", values: [2, 2], isDefault: false, updatedAt: now },
  ],
  routes: [
    { id: "route-arena-a", name: "טבעת צפונית", arena: "זירה א׳", vehicleType: "סער", family: "SI", geometry: "MULTIPOLYGON (((34.800000 31.800000, 34.801000 31.800000, 34.801000 31.801000, 34.800000 31.801000, 34.800000 31.800000)))", updatedAt: now },
    { id: "route-arena-b", name: "היפודרום מזרחי", arena: "זירה א׳", vehicleType: "ברק", family: "SO", geometry: "MULTIPOLYGON (((34.802000 31.800000, 34.804000 31.800000, 34.804000 31.801000, 34.802000 31.801000, 34.802000 31.800000)))", updatedAt: now },
  ],
  influx: {
    url: "http://influx.internal:8086",
    organization: "blue-wolf",
    bucket: "navigation",
    idleProbeMinutes: 5,
    activePollSeconds: 5,
    joinToleranceSeconds: 5,
    activeOnValue: "green",
    mappings: { vehicleNumber: "vehicle_number", uniqueVehicleId: "vehicle_id", active: "active", latitude: "latitude", longitude: "longitude", altitude: "altitude", velocityNorth: "velocity_north", velocityEast: "velocity_east" },
  },
  servers: Array.from({ length: 3 }, (_, index) => ({ id: String(index + 1), name: `שרת ${String(index + 1).padStart(2, "0")}`, enabled: true })),
  vehicleTypes: [
    { id: "storm", name: "סער", minId: 100, maxId: 199, workSpeedKmh: 45, siRoles: ["inner"] },
    { id: "lightning", name: "ברק", minId: 200, maxId: 299, workSpeedKmh: 55, siRoles: ["middle"] },
    { id: "thunder", name: "רעם", minId: 300, maxId: 399, workSpeedKmh: 65, siRoles: ["outer"] },
  ],
  gtSegments: [
    { id: "gt-1", family: "SI", layer: "sync", quality: "good", label: "SI · סנכרון טוב · מקטע 01" },
    { id: "gt-2", family: "SO", layer: "route", quality: "medium", label: "SO · נתיב בינוני · מקטע 02" },
  ],
  settings: { timezone: "Asia/Jerusalem", retentionDays: 90, maxSoVehicles: 8, uiRefreshSeconds: 2, defaultMap: "engineering" },
  investigationEdits: {},
};

export const SCORE_SERIES = Array.from({ length: 60 }, (_, index) => {
  const siSync = 89 + Math.sin(index / 5) * 4 - (index > 40 && index < 46 ? 10 : 0);
  const soSync = 75 + Math.sin(index / 7 + 1.2) * 5 - (index > 27 && index < 41 ? 19 : 0);
  const siRoute = 80 + Math.sin(index / 8 + 1) * 5;
  const soRoute = 82 + Math.sin(index / 9) * 4 - (index > 31 && index < 37 ? 8 : 0);
  return {
    index,
    si: { sync: Math.round(siSync), route: Math.round(siRoute), total: Math.round(siSync * .75 + siRoute * .25) },
    so: { sync: Math.round(soSync), route: Math.round(soRoute), total: Math.round(soSync * .75 + soRoute * .25) },
  };
});

export const canonicalTemplateKey = (template: Pick<SyncTemplate, "family" | "mix" | "constellation" | "values">) => {
  const forward = `${template.family}|${template.mix}|${template.constellation}|${template.values.join(",")}`;
  const mirrored = `${template.family}|${template.mix}|${template.constellation.split(" — ").reverse().join(" — ")}|${[...template.values].reverse().join(",")}`;
  return [forward, mirrored].sort()[0];
};

export const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
