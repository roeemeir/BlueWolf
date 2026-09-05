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
export type SoTemplateEntity = { kind: Exclude<SoRouteKind, "double-figure8">; vehicleTypes: string[] };
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
export type ServerDefinition = { id: string; name: string; enabled: boolean; influxTag: string };
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
    { id: "tpl-so-chain", family: "SO", name: "SO · יחיד — כפול רציף — יחיד", mix: "סער×1 · ברק×2 · רעם×1", constellation: "יחיד — כפול — יחיד", law: "קשר גיאומטרי + same/opposite/mixed בין ישויות סמוכות; ללא זווית קשיחה", values: [2, 0], soSpec: defaultSoSpec, isDefault: true, updatedAt: now },
    { id: "tpl-so-mixed", family: "SO", name: "SO · כפול עם יחס מעורב", mix: "סער×1 · ברק×2 · רעם×1", constellation: "יחיד — כפול — יחיד", law: "mixed חוקי רק בזוג סמוך הכולל Double", values: [1, 0], soSpec: { ...defaultSoSpec, relations: ["mixed", "same"] }, isDefault: false, updatedAt: now },
  ],
  routes: [
    { id: "route-si-north", name: "טבעת צפונית", arena: "זירה א׳", vehicleType: "סער", family: "SI", geometry: "CLOSED_ROUTE", updatedAt: now, routeKind: "compact", mapX: 22, mapY: 34, rotationDeg: 0, scalePct: 100, mapServerId: "engineering" },
    { id: "route-so-east", name: "SO מזרחי", arena: "זירה א׳", vehicleType: "ברק", family: "SO", geometry: "CLOSED_ROUTE", updatedAt: now, routeKind: "single", mapX: 55, mapY: 34, rotationDeg: -20, scalePct: 100, mapServerId: "engineering" },
    { id: "route-so-double-west", name: "SO כפול מערבי", arena: "זירה ב׳", vehicleType: "רעם", family: "SO", geometry: "CLOSED_ROUTE", updatedAt: now, routeKind: "double", mapX: 72, mapY: 62, rotationDeg: 15, scalePct: 100, mapServerId: "engineering", controlPoints: [{ x: -1, y: 0 }, { x: -0.5, y: -0.7 }, { x: 0, y: -0.1 }, { x: 0.5, y: -0.7 }, { x: 1, y: 0 }, { x: 0.5, y: 0.7 }, { x: 0, y: 0.1 }, { x: -0.5, y: 0.7 }] },
  ],
  mapServers: [
    { id: "engineering", name: "מפת הנדסה", kind: "engineering", urlTemplate: "https://maps.internal/engineering/{z}/{x}/{y}.png", attribution: "BlueWolf GIS", enabled: true, isDefault: true, cacheMode: "day-offline" },
    { id: "wmts", name: "WMTS ארגוני", kind: "wmts", urlTemplate: "https://maps.internal/wmts/{z}/{x}/{y}.png", attribution: "BlueWolf GIS", enabled: true, isDefault: false, tokenRef: "MAP_WMTS_TOKEN", cacheMode: "day-offline" },
  ],
  influx: { url: "http://influx.internal:8086", organization: "blue-wolf", token: "", idleProbeMinutes: 5, activePollSeconds: 5, joinToleranceSeconds: 5, mappings: DEFAULT_INFLUX_MAPPINGS },
  servers: Array.from({ length: 3 }, (_, index) => ({ id: String(index + 1), name: `שרת ${String(index + 1).padStart(2, "0")}`, enabled: true, influxTag: `ttag-${index + 1}` })),
  arenas: ["זירה א׳", "זירה ב׳", "זירה ג׳"],
  vehicleTypes: [
    { id: "storm", name: "סער", minId: 100, maxId: 199, idRanges: [{ min: 100, max: 199 }, { min: 500, max: 549 }], workSpeedKmh: 45, siRoles: ["inner"], icon: "rover", color: "#ff9f43" },
    { id: "lightning", name: "ברק", minId: 200, maxId: 299, idRanges: [{ min: 200, max: 299 }], workSpeedKmh: 55, siRoles: ["middle"], icon: "truck", color: "#34b7eb" },
    { id: "thunder", name: "רעם", minId: 300, maxId: 399, idRanges: [{ min: 300, max: 399 }], workSpeedKmh: 65, siRoles: ["outer"], icon: "shield", color: "#9068ff" },
  ],
  gtSegments: [
    { id: "gt-1", family: "SI", layer: "sync", quality: "good", label: "SI-01 · סנכרון טוב · 18:12–18:47", serverId: "1", groupId: "SI-01", start: "2026-09-02T18:12", end: "2026-09-02T18:47", vehicleCount: 3, routeType: "compact", score: 91, participants: [101, 201, 301], clipStartPct: 0, clipEndPct: 100, arena: "זירה א׳" },
    { id: "gt-2", family: "SO", layer: "route", quality: "medium", label: "SO-02 · נתיב בינוני · 18:21–18:39", serverId: "1", groupId: "SO-02", start: "2026-09-02T18:21", end: "2026-09-02T18:39", vehicleCount: 4, routeType: "double", score: 67, participants: [111, 112, 211, 212], clipStartPct: 8, clipEndPct: 92, arena: "זירה א׳" },
  ],
  activeTemplateOverrides: {},
  templateApplications: {},
  settings: { timezone: "Asia/Jerusalem", retentionDays: 90, maxSoVehicles: 8, uiRefreshSeconds: 5, defaultMap: "engineering" },
  investigationEdits: {},
};

const makeSi = (server: number, offset: number, total: number): DemoGroup => ({
  key: "si", id: `SI-${String(server * 2 - 1).padStart(2, "0")}`, name: `קבוצה SI-${String(server * 2 - 1).padStart(2, "0")}`, family: "SI", subtitle: "מסלול compact · כיוון אחיד", total, sync: Math.min(96, total + 4), route: Math.max(54, total - 7), confidence: 94 - server, color: "#20b9a8", templateId: "tpl-si-120", reason: server === 2 ? "סטיית זווית מתמשכת בין שני רכבים" : "הפרשי הזווית יציבים", success: "מרכז משותף וזמן מחזור תואם",
  members: [
    { id: 101 + offset, typeId: "storm", score: total + 2, sync: total + 5, route: total - 4, confidence: 95, phase: 0, ring: "inner" },
    { id: 201 + offset, typeId: "lightning", score: total - 1, sync: total + 2, route: total - 8, confidence: 93, phase: 1 / 3, ring: "middle" },
    { id: 301 + offset, typeId: "thunder", score: total - 3, sync: total, route: total - 9, confidence: 92, phase: 2 / 3, ring: "outer" },
  ],
});

const makeSo = (server: number, offset: number, total: number): DemoGroup => ({
  key: "so", id: `SO-${String(server * 2).padStart(2, "0")}`, name: `קבוצה SO-${String(server * 2).padStart(2, "0")}`, family: "SO", subtitle: "יחיד — Double רציף — יחיד", total, sync: Math.max(35, total - 7), route: Math.min(94, total + 17), confidence: 91 - server, color: "#5577e8", templateId: "tpl-so-chain", reason: total < 70 ? `רכב ${212 + offset} מאחר בפנייה` : "הפניות מתוזמנות והפאזות יציבות", success: "המרחק מהנתיב והכיוון המשיק נשמרים", alert: total < 70 ? { title: "תזמון פנייה מחוץ לסף", detail: `רכב ${212 + offset} מאחר בכניסה לפנייה; זה Alert חי בלבד ולא Event.`, severity: total < 55 ? "critical" : "warning" } : undefined,
  members: [
    { id: 111 + offset, typeId: "storm", score: total + 4, sync: total - 1, route: total + 14, confidence: 92, phase: .06 },
    { id: 112 + offset, typeId: "storm", score: total - 7, sync: total - 15, route: total + 10, confidence: 89, phase: .56 },
    { id: 211 + offset, typeId: "lightning", score: total + 2, sync: total - 4, route: total + 15, confidence: 91, phase: .31 },
    { id: 212 + offset, typeId: "lightning", score: total - 11, sync: total - 21, route: total + 7, confidence: 87, phase: .79 },
  ],
});

export const SERVER_SCENARIOS: Record<string, ServerScenario> = {
  "1": { id: "1", status: "2 קבוצות · 7 רכבים", groups: { si: makeSi(1, 0, 86), so: makeSo(1, 0, 63) } },
  "2": { id: "2", status: "2 קבוצות · 7 רכבים", groups: { si: makeSi(2, 20, 72), so: makeSo(2, 20, 84) } },
  "3": { id: "3", status: "2 קבוצות · 7 רכבים", groups: { si: makeSi(3, 40, 91), so: makeSo(3, 40, 76) } },
};

export const getServerScenario = (serverId: string) => SERVER_SCENARIOS[serverId] ?? SERVER_SCENARIOS["1"];

export const scoreSeriesForServer = (serverId: string, points = 120) => {
  const scenario = getServerScenario(serverId);
  const seed = Number(serverId) || 1;
  return Array.from({ length: points }, (_, index) => {
    const incident = index > points * .46 && index < points * .66;
    const recovery = index > points * .82;
    const siSync = scenario.groups.si.sync + Math.sin(index / 7 + seed) * 4 - (seed === 2 && incident ? 10 : 0);
    const soSync = scenario.groups.so.sync + Math.sin(index / 9 + seed * .8) * 5 - (seed === 1 && incident ? 18 : 0) + (recovery ? 5 : 0);
    const siRoute = scenario.groups.si.route + Math.sin(index / 11 + 1) * 4;
    const soRoute = scenario.groups.so.route + Math.sin(index / 13) * 3 - (incident ? 4 : 0);
    const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
    return { index, si: { sync: clampScore(siSync), route: clampScore(siRoute), total: clampScore(siSync * .75 + siRoute * .25) }, so: { sync: clampScore(soSync), route: clampScore(soRoute), total: clampScore(soSync * .75 + soRoute * .25) } };
  });
};

export const SCORE_SERIES = scoreSeriesForServer("1", 120);

export const generateSiAngleSets = (vehicleCount: number) => {
  if (vehicleCount < 2 || vehicleCount > 8) return [] as number[][];
  const relationCount = vehicleCount - 1;
  const patterns = [
    Array(relationCount).fill(45),
    Array(relationCount).fill(90),
    Array(relationCount).fill(120),
    Array.from({ length: relationCount }, (_, index) => SI_ALLOWED_PAIR_ANGLES[index % SI_ALLOWED_PAIR_ANGLES.length]),
    Array.from({ length: relationCount }, (_, index) => SI_ALLOWED_PAIR_ANGLES[(index + 1) % SI_ALLOWED_PAIR_ANGLES.length]),
  ];
  return patterns.map((values) => [...values]);
};

export const relationCode = (relation: SoRelation) => relation === "same" ? 0 : relation === "mixed" ? 1 : 2;
export const relationFromCode = (value: number): SoRelation => value === 0 ? "same" : value === 1 ? "mixed" : "opposite";

const stableCounts = (counts: Record<string, number> | undefined) => Object.entries(counts ?? {}).filter(([, value]) => value > 0).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}`).join(",");

export const canonicalTemplateKey = (template: Pick<SyncTemplate, "family" | "mix" | "constellation" | "values" | "soSpec">) => {
  if (template.family === "SI") return `SI|${template.mix}|${template.values.join(",")}`;
  const spec = template.soSpec;
  const chain = spec?.entities?.length ? spec.entities.map((entity) => `${entity.kind}:${[...entity.vehicleTypes].sort().join("+")}`) : (spec?.chain ?? template.constellation.split(" — ")).map(String);
  const relations = spec?.relations ?? template.values.map(relationFromCode);
  const forward = `${chain.join("|")}#${relations.join("|")}`;
  const reverse = `${[...chain].reverse().join("|")}#${[...relations].reverse().join("|")}`;
  return `SO|${stableCounts(spec?.singleCounts)}|${stableCounts(spec?.doubleCounts)}|${stableCounts(spec?.figure8Counts)}|${forward < reverse ? forward : reverse}`;
};

export const createId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
