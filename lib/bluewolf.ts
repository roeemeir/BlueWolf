export type Family = "SI" | "SO";
export type Quality = "good" | "medium" | "low" | "transition";
export type DataMode = "simulation" | "influx";
export type DeveloperSection = "score" | "templates" | "gt" | "influx" | "routes" | "tests" | "settings";
export type VehicleIconName = "rover" | "truck" | "shield" | "drone" | "boat";
export type RingRole = "inner" | "middle" | "outer";
export type SoRelation = "same" | "opposite" | "mixed";
export type SoRouteKind = "single" | "double" | "figure8" | "double-figure8";
export type MapSourceKind = "engineering" | "wms" | "wmts" | "xyz";

export const SI_ALLOWED_PAIR_ANGLES = [45, 90, 120] as const;
export const SO_RELATION_LABELS: Record<SoRelation, string> = { same: "זהה", opposite: "הפוך", mixed: "מעורב" };

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

export type SiPairRule = { first: number; second: number; angle: number };
export type SoTemplateEntity = {
  kind: Exclude<SoRouteKind, "double-figure8">;
  vehicleTypes: string[];
  /** Separate route entity may share its geometric center with the next entity. */
  overlapWithNext?: boolean;
};
export type SoTemplateSpec = {
  singleCounts: Record<string, number>;
  doubleCounts: Record<string, number>;
  figure8Counts: Record<string, number>;
  chain: SoRouteKind[];
  relations: SoRelation[];
  /** Explicit ordered placement. Optional only for migration of pre-v0.8 records. */
  entities?: SoTemplateEntity[];
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
  vehicleCount?: number;
  siPairs?: SiPairRule[];
  soSpec?: SoTemplateSpec;
};

export type RouteControlPoint = { x: number; y: number };
export type SavedRoute = {
  id: string;
  name: string;
  /** Arena is reporting/library metadata only; never a live grouping input. */
  arena: string;
  vehicleType: string;
  family: Family;
  geometry: string;
  updatedAt: string;
  routeKind?: SoRouteKind | "compact";
  mapX?: number;
  mapY?: number;
  rotationDeg?: number;
  scalePct?: number;
  mapServerId?: string;
  controlPoints?: RouteControlPoint[];
};

export type MapServerDefinition = {
  id: string;
  name: string;
  kind: MapSourceKind;
  urlTemplate: string;
  attribution: string;
  enabled: boolean;
  isDefault: boolean;
  tokenRef?: string;
  cacheMode?: "online" | "day-offline";
};
export type InfluxValueMode = "as-is" | "special";
export type InfluxFillMode = "forward-fill" | "linear";
export type InfluxValueRule = { sourceValue: string; mappedValue: string };
export type InfluxFieldMapping = { systemKey: string; label: string; bucket: string; measurement: string; key: string; valueMode: InfluxValueMode; sourceValue: string; mappedValue: string; rules?: InfluxValueRule[]; fallbackValue?: string; fillMode: InfluxFillMode };
export type InfluxSettings = { url: string; organization: string; token: string; idleProbeMinutes: number; activePollSeconds: number; joinToleranceSeconds: number; mappings: InfluxFieldMapping[] };
export type ServerDefinition = { id: string; name: string; enabled: boolean };
export type VehicleIdRange = { min: number; max: number };
export type VehicleType = { id: string; name: string; minId: number; maxId: number; idRanges?: VehicleIdRange[]; workSpeedKmh: number; siRoles: RingRole[]; icon: VehicleIconName; color: string };
export type GtSegment = { id: string; family: Family; layer: "sync" | "route"; quality: "good" | "medium" | "low"; label: string; serverId: string; groupId: string; start: string; end: string; vehicleCount: number; routeType: string; score: number; participants?: number[]; clipStartPct?: number; clipEndPct?: number; arena?: string; routeCorrected?: boolean };
export type TemplateApplication = { templateId: string; mode: "now" | "event-start"; appliedAt: string };

export type WorkspaceState = {
  weights: ScoreWeights;
  thresholds: ScoreThresholds;
  templates: SyncTemplate[];
  routes: SavedRoute[];
  mapServers: MapServerDefinition[];
  influx: InfluxSettings;
  servers: ServerDefinition[];
  arenas: string[];
  vehicleTypes: VehicleType[];
  gtSegments: GtSegment[];
  activeTemplateOverrides: Record<string, string>;
  templateApplications: Record<string, TemplateApplication>;
  settings: { timezone: string; retentionDays: number; maxSoVehicles: number; uiRefreshSeconds: number; defaultMap: string };
  investigationEdits: Record<string, { note: string; templateId: string; arena?: string }>;
};

export type DemoGroupKey = "si" | "so";
export type DemoVehicle = { id: number; typeId: string; score: number; sync: number; route: number; confidence: number; phase: number; ring?: RingRole };
export type DemoGroup = { key: DemoGroupKey; id: string; name: string; family: Family; subtitle: string; total: number; sync: number; route: number; confidence: number; color: string; members: DemoVehicle[]; templateId: string; reason: string; success: string; alert?: { title: string; detail: string; severity: "warning" | "critical" } };
export type ServerScenario = { id: string; status: string; groups: Record<DemoGroupKey, DemoGroup> };

const now = "2026-09-05T18:00:00.000Z";

export const DEFAULT_INFLUX_MAPPINGS: InfluxFieldMapping[] = [
  { systemKey: "vehicleNumber", label: "מספר רכב", bucket: "navigation", measurement: "vehicle_number", key: "value", valueMode: "as-is", sourceValue: "", mappedValue: "", fillMode: "linear" },
  { systemKey: "uniqueVehicleId", label: "מזהה רכב ייחודי", bucket: "navigation", measurement: "vehicle_id", key: "value", valueMode: "as-is", sourceValue: "", mappedValue: "", fillMode: "forward-fill" },
  { systemKey: "active", label: "Active", bucket: "navigation", measurement: "active", key: "color", valueMode: "special", sourceValue: "green", mappedValue: "true", rules: [{ sourceValue: "green", mappedValue: "true" }], fallbackValue: "false", fillMode: "forward-fill" },
  { systemKey: "latitude", label: "קו רוחב", bucket: "navigation", measurement: "latitude", key: "value", valueMode: "as-is", sourceValue: "", mappedValue: "", fillMode: "linear" },
  { systemKey: "longitude", label: "קו אורך", bucket: "navigation", measurement: "longitude", key: "value", valueMode: "as-is", sourceValue: "", mappedValue: "", fillMode: "linear" },
  { systemKey: "altitude", label: "גובה", bucket: "navigation", measurement: "altitude", key: "value", valueMode: "as-is", sourceValue: "", mappedValue: "", fillMode: "linear" },
  { systemKey: "velocityNorth", label: "מהירות צפון", bucket: "navigation", measurement: "velocity_north", key: "value", valueMode: "as-is", sourceValue: "", mappedValue: "", fillMode: "linear" },
  { systemKey: "velocityEast", label: "מהירות מזרח", bucket: "navigation", measurement: "velocity_east", key: "value", valueMode: "as-is", sourceValue: "", mappedValue: "", fillMode: "linear" },
];

export const THRESHOLD_DESCRIPTIONS: Record<keyof ScoreThresholds, string> = {
  siPositionFullDeg: "סטיית זווית מרבית ב־SI שעד אליה רכיב המיקום נשאר 100.",
  siPositionZeroDeg: "מנקודה זו סטיית הזווית ב־SI מורידה את רכיב המיקום ל־0.",
  soPositionFullPct: "סטיית פאזה ב־SO שעד אליה הרכב עדיין נחשב באותו מיקום יחסי.",
  soPositionZeroPct: "סטיית פאזה ב־SO שממנה רכיב המיקום הוא 0.",
  periodFullPct: "פער יחסי בזמן המחזור שעד אליו רכיב המחזור מקבל 100.",
  periodZeroPct: "פער יחסי בזמן המחזור שממנו רכיב המחזור מקבל 0.",
  motionFullPct: "פער בקצב ההתקדמות שעד אליו רכיב התנועה נשאר מלא.",
  motionZeroPct: "פער בקצב ההתקדמות שממנו רכיב התנועה הוא 0.",
  routeDistanceFullPct: "מרחק מהנתיב ביחס לחצי הציר הקצר b שעד אליו אין עונש.",
  routeDistanceZeroPct: "מרחק יחסי מהנתיב שממנו רכיב המרחק הוא 0.",
  tangentFullDeg: "סטיית כיוון מתוואי המשיק שעד אליה רכיב המשיק נשאר 100.",
  tangentZeroDeg: "סטיית כיוון מהמשיק שממנה רכיב המשיק הוא 0.",
  curvatureFullPct: "שגיאת עקמומיות מנורמלת שעד אליה אין עונש.",
  curvatureZeroPct: "שגיאת עקמומיות מנורמלת שממנה רכיב העקמומיות הוא 0.",
  lowSpeedPct: "מתחת לאחוז זה ממהירות העבודה לא מחשבים רכיבי תנועה כיווניים.",
  smoothingSeconds: "משך חלון ההחלקה של הציון המוצג.",
  greenScore: "מהציון הכולל הזה ומעלה הביצוע נחשב טוב.",
  redScore: "מתחת לציון הכולל הזה הביצוע נחשב נמוך.",
};

const defaultSoSpec: SoTemplateSpec = {
  singleCounts: { storm: 1, lightning: 0, thunder: 1 },
  doubleCounts: { storm: 0, lightning: 2, thunder: 0 },
  figure8Counts: { storm: 0, lightning: 0, thunder: 0 },
  chain: ["single", "double", "single"],
  relations: ["opposite", "same"],
  entities: [
    { kind: "single", vehicleTypes: ["storm"] },
    { kind: "double", vehicleTypes: ["lightning", "lightning"] },
    { kind: "single", vehicleTypes: ["thunder"] },
  ],
};

export const DEFAULT_WORKSPACE: WorkspaceState = {
  weights: { sync: { position: 60, period: 20, motion: 20 }, route: { distance: 15, tangent: 70, curvature: 15 }, total: { sync: 75, route: 25 } },
  thresholds: { siPositionFullDeg: 10, siPositionZeroDeg: 30, soPositionFullPct: 5, soPositionZeroPct: 25, periodFullPct: 5, periodZeroPct: 20, motionFullPct: 10, motionZeroPct: 30, routeDistanceFullPct: 5, routeDistanceZeroPct: 30, tangentFullDeg: 10, tangentZeroDeg: 60, curvatureFullPct: 10, curvatureZeroPct: 100, lowSpeedPct: 30, smoothingSeconds: 10, greenScore: 80, redScore: 50 },
  templates: [
    { id: "tpl-si-120", family: "SI", name: "SI · שלושה רכבים · 120°", mix: "סער×1 · ברק×1 · רעם×1", constellation: "סער — ברק — רעם", law: "n−1 יחסים עוקבים; common phase חופשי", values: [120, 120], siPairs: [{ first: 0, second: 1, angle: 120 }, { first: 1, second: 2, angle: 120 }], vehicleCount: 3, isDefault: true, updatedAt: now },
    { id: "tpl-si-90", family: "SI", name: "SI · שרשרת 90°", mix: "סער×1 · ברק×1 · רעם×1", constellation: "סער — ברק — רעם", law: "n−1 יחסים עוקבים; common phase חופשי", values: [90, 90], siPairs: [{ first: 0, second: 1, angle: 90 }, { first: 1, second: 2, angle: 90 }], vehicleCount: 3, isDefault: false, updatedAt: now },
    { id: "tpl-so-chain", family: "SO", name: "SO · יחיד—כפול—יחיד", mix: "סער×1 · ברק×2 · רעם×1", constellation: "יחיד סער — כפול ברק — יחיד רעם", law: "יחסי שכנים בלבד; Mixed רק ליד Double", values: [2, 0], soSpec: defaultSoSpec, isDefault: true, updatedAt: now },
  ],
  routes: [
    { id: "route-si-1", name: "SI North Ring", arena: "זירה א׳", vehicleType: "סער", family: "SI", geometry: "CLOSED_ROUTE", updatedAt: now, routeKind: "compact", mapX: 25, mapY: 48, rotationDeg: 0, scalePct: 100 },
    { id: "route-so-1", name: "SO Bravo East", arena: "זירה א׳", vehicleType: "ברק", family: "SO", geometry: "CLOSED_ROUTE", updatedAt: now, routeKind: "double", mapX: 70, mapY: 45, rotationDeg: -7, scalePct: 100 },
    { id: "route-so-2", name: "SO South Single", arena: "זירה ב׳", vehicleType: "רעם", family: "SO", geometry: "CLOSED_ROUTE", updatedAt: now, routeKind: "single", mapX: 79, mapY: 66, rotationDeg: 32, scalePct: 95 },
  ],
  mapServers: [
    { id: "engineering", name: "מפת הנדסה", kind: "engineering", urlTemplate: "local://engineering", attribution: "Blue Wolf", enabled: true, isDefault: true, cacheMode: "day-offline" },
    { id: "wmts-1", name: "WMTS", kind: "wmts", urlTemplate: "https://maps.example/{z}/{x}/{y}", attribution: "Configured map", enabled: false, isDefault: false, tokenRef: "MAP_TOKEN", cacheMode: "online" },
  ],
  influx: { url: "", organization: "", token: "", idleProbeMinutes: 5, activePollSeconds: 5, joinToleranceSeconds: 5, mappings: DEFAULT_INFLUX_MAPPINGS },
  servers: [
    { id: "1", name: "שרת 1", enabled: true },
    { id: "2", name: "שרת 2", enabled: true },
    { id: "3", name: "שרת 3", enabled: true },
  ],
  arenas: ["זירה א׳", "זירה ב׳", "זירה ג׳"],
  vehicleTypes: [
    { id: "storm", name: "סער", minId: 100, maxId: 199, idRanges: [{ min: 100, max: 199 }], workSpeedKmh: 45, siRoles: ["inner", "middle", "outer"], icon: "rover", color: "#ff9f43" },
    { id: "lightning", name: "ברק", minId: 200, maxId: 299, idRanges: [{ min: 200, max: 299 }], workSpeedKmh: 48, siRoles: ["inner", "middle", "outer"], icon: "truck", color: "#34b7eb" },
    { id: "thunder", name: "רעם", minId: 300, maxId: 399, idRanges: [{ min: 300, max: 399 }], workSpeedKmh: 42, siRoles: ["inner", "middle", "outer"], icon: "shield", color: "#9068ff" },
  ],
  gtSegments: [],
  activeTemplateOverrides: {},
  templateApplications: {},
  settings: { timezone: "Asia/Jerusalem", retentionDays: 30, maxSoVehicles: 8, uiRefreshSeconds: 2, defaultMap: "engineering" },
  investigationEdits: {},
};

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function relationCode(relation: SoRelation) { return relation === "same" ? 0 : relation === "mixed" ? 1 : 2; }
export function relationFromCode(value: number): SoRelation { return value === 0 ? "same" : value === 1 ? "mixed" : "opposite"; }

export function canonicalTemplateKey(template: SyncTemplate) {
  if (template.family === "SI") return `SI:${(template.siPairs?.map((pair) => pair.angle) ?? template.values).join(",")}:${template.vehicleCount ?? template.values.length + 1}`;
  const entities = template.soSpec?.entities ?? [];
  const forward = entities.map((entity) => `${entity.kind}:${entity.vehicleTypes.join("+")}:${entity.overlapWithNext ? "stack" : ""}`).join("|");
  const reverse = [...entities].reverse().map((entity, index) => `${entity.kind}:${[...entity.vehicleTypes].reverse().join("+")}:${entities[entities.length - 2 - index]?.overlapWithNext ? "stack" : ""}`).join("|");
  const relations = template.soSpec?.relations ?? template.values.map(relationFromCode);
  const reverseRelations = [...relations].reverse();
  const a = `${forward}#${relations.join("|")}`;
  const b = `${reverse}#${reverseRelations.join("|")}`;
  return `SO:${a < b ? a : b}`;
}

export function getServerScenario(id: string): ServerScenario {
  const base: Record<string, ServerScenario> = {
    "1": {
      id: "1", status: "baseline + SO turn timing", groups: {
        si: { key: "si", id: "SI-ALPHA", name: "SI Alpha", family: "SI", subtitle: "טבעת משותפת · CW", total: 91, sync: 94, route: 83, confidence: 97, color: "#1bb19f", templateId: "tpl-si-120", reason: "יציב", success: "זוויות תקינות", members: [
          { id: 111, typeId: "storm", score: 93, sync: 96, route: 84, confidence: 98, phase: 0.05, ring: "outer" },
          { id: 211, typeId: "lightning", score: 89, sync: 92, route: 82, confidence: 96, phase: 0.38, ring: "middle" },
          { id: 311, typeId: "thunder", score: 91, sync: 94, route: 83, confidence: 97, phase: 0.71, ring: "outer" },
        ] },
        so: { key: "so", id: "SO-BRAVO", name: "SO Bravo", family: "SO", subtitle: "יחיד—כפול—יחיד", total: 79, sync: 76, route: 88, confidence: 93, color: "#5b78ef", templateId: "tpl-so-chain", reason: "איחור בפנייה", success: "Route יציב", alert: { title: "איחור בפנייה", detail: "פער תזמון בפנייה הרחוקה", severity: "warning" }, members: [
          { id: 112, typeId: "storm", score: 82, sync: 79, route: 91, confidence: 95, phase: 0.08 },
          { id: 212, typeId: "lightning", score: 77, sync: 72, route: 92, confidence: 92, phase: 0.32 },
          { id: 213, typeId: "lightning", score: 75, sync: 70, route: 90, confidence: 91, phase: 0.56 },
          { id: 312, typeId: "thunder", score: 81, sync: 83, route: 75, confidence: 94, phase: 0.78 },
        ] },
      },
    },
    "2": {
      id: "2", status: "join/leave + period drift", groups: {
        si: { key: "si", id: "SI-DELTA", name: "SI Delta", family: "SI", subtitle: "period drift", total: 72, sync: 66, route: 90, confidence: 91, color: "#1bb19f", templateId: "tpl-si-90", reason: "סטיית מחזור", success: "גיאומטריה תקינה", members: [
          { id: 121, typeId: "storm", score: 75, sync: 69, route: 92, confidence: 92, phase: 0.04, ring: "outer" },
          { id: 221, typeId: "lightning", score: 68, sync: 60, route: 91, confidence: 89, phase: 0.33, ring: "middle" },
          { id: 321, typeId: "thunder", score: 73, sync: 69, route: 86, confidence: 91, phase: 0.69, ring: "outer" },
        ] },
        so: { key: "so", id: "SO-ECHO", name: "SO Echo", family: "SO", subtitle: "vehicle join/leave", total: 84, sync: 82, route: 91, confidence: 90, color: "#5b78ef", templateId: "tpl-so-chain", reason: "חברות משתנה", success: "קיבוץ לפי geometry+period", members: [
          { id: 122, typeId: "storm", score: 85, sync: 83, route: 91, confidence: 92, phase: 0.11 },
          { id: 222, typeId: "lightning", score: 82, sync: 79, route: 91, confidence: 89, phase: 0.37 },
          { id: 322, typeId: "thunder", score: 86, sync: 85, route: 90, confidence: 90, phase: 0.72 },
        ] },
      },
    },
    "3": {
      id: "3", status: "disconnect + SO→SI transition", groups: {
        si: { key: "si", id: "SI-FOXTROT", name: "SI Foxtrot", family: "SI", subtitle: "transition target", total: 87, sync: 89, route: 81, confidence: 90, color: "#1bb19f", templateId: "tpl-si-120", reason: "מעבר גיאומטריה", success: "SI אושר", members: [
          { id: 131, typeId: "storm", score: 88, sync: 90, route: 82, confidence: 91, phase: 0.06, ring: "outer" },
          { id: 231, typeId: "lightning", score: 86, sync: 88, route: 80, confidence: 89, phase: 0.39, ring: "middle" },
        ] },
        so: { key: "so", id: "SO-GOLF", name: "SO Golf", family: "SO", subtitle: "disconnect/gaps", total: 58, sync: 53, route: 74, confidence: 72, color: "#5b78ef", templateId: "tpl-so-chain", reason: "פערי נתונים", success: "Hold מונע split רגעי", alert: { title: "פער נתונים", detail: "רכב 233 נעדר זמנית", severity: "critical" }, members: [
          { id: 133, typeId: "storm", score: 61, sync: 57, route: 74, confidence: 75, phase: 0.10 },
          { id: 233, typeId: "lightning", score: 49, sync: 43, route: 68, confidence: 61, phase: 0.34 },
          { id: 333, typeId: "thunder", score: 64, sync: 59, route: 79, confidence: 80, phase: 0.71 },
        ] },
      },
    },
  };
  return base[id] ?? base["1"];
}

export function scoreSeriesForServer(id: string, count = 120) {
  const scenario = getServerScenario(id);
  return Array.from({ length: count }, (_, index) => {
    const wave = (phase: number, amp: number) => Math.sin(index / 9 + phase) * amp + Math.sin(index / 3.7 + phase * 0.4) * amp * 0.32;
    const row = (group: DemoGroup, phase: number) => ({
      total: Math.max(0, Math.min(100, group.total + wave(phase, 5))),
      sync: Math.max(0, Math.min(100, group.sync + wave(phase + 0.8, 7))),
      route: Math.max(0, Math.min(100, group.route + wave(phase + 1.5, 4))),
    });
    return { index, si: row(scenario.groups.si, 0.3), so: row(scenario.groups.so, 1.7) };
  });
}