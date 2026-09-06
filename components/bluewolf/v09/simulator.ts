import type { SoRelation } from "@/lib/bluewolf";
import { doubleHippodromeLoop, hippodromeLoop, type Point } from "./geometry";
import { DEFAULT_SO_GROUPING, largestCompatibleComponent, type SoGeometryDescriptor, type SoGroupingSettings } from "../v10/grouping";

export type V09Vehicle = { id: number; typeId: string; phase: number; routeKey: string; ring?: "inner" | "middle" | "outer"; confidence: number };
export type V09Group = { key: "si" | "so"; id: string; name: string; family: "SI" | "SO"; members: V09Vehicle[]; observedAngles?: number[]; observedRelations?: SoRelation[]; routeScore: number; periodErrorPct: number; motionErrorPct: number; reason: string };
export type V09RouteShape = { key: string; kind: "circle" | "single" | "double"; points: Point[]; typeId: string; geometry?: SoGeometryDescriptor };
export type V09Scenario = { id: string; title: string; subtitle: string; groups: { si: V09Group; so: V09Group }; routes: V09RouteShape[]; eventNote: string; ungroupedMembers?: V09Vehicle[]; groupingNotes?: string[] };

const TYPE_IDS = ["storm", "lightning", "thunder"];
const circleRoute = (key: string, center: Point, radius: number, typeId: string): V09RouteShape => ({ key, kind: "circle", points: hippodromeLoop(center, radius, 0), typeId });
const singleRoute = (key: string, center: Point, radius: number, legLength: number, rotationDeg: number, typeId: string): V09RouteShape => ({ key, kind: "single", points: hippodromeLoop(center, radius, legLength, rotationDeg), typeId, geometry: { kind: "single", center, radius, legLength, rotationDeg } });
const doubleRoute = (key: string, center: Point, radius: number, leftLeg: number, rightLeg: number, bendDeg: number, rotationDeg: number, typeId: string): V09RouteShape => ({ key, kind: "double", points: doubleHippodromeLoop(center, radius, leftLeg, rightLeg, bendDeg, rotationDeg), typeId, geometry: { kind: "double", center, radius, legLength: leftLeg, secondLegLength: rightLeg, bendDeg, rotationDeg } });

function groupSoCandidates(routes: V09RouteShape[], vehicles: V09Vehicle[], settings: SoGroupingSettings) {
  const candidates = routes.filter((route): route is V09RouteShape & { geometry: SoGeometryDescriptor } => Boolean(route.geometry));
  const result = largestCompatibleComponent(candidates, settings);
  const groupedKeys = new Set(result.grouped.map((route) => route.key));
  const grouped = vehicles.filter((vehicle) => groupedKeys.has(vehicle.routeKey));
  const ungrouped = vehicles.filter((vehicle) => !groupedKeys.has(vehicle.routeKey));
  const notes: string[] = [];
  candidates.forEach((a, i) => candidates.slice(i + 1).forEach((b, offset) => {
    const evidence = result.pairEvidence.get(`${i}:${i + 1 + offset}`);
    if (evidence) notes.push(`${a.key} ↔ ${b.key}: ${evidence.explanation}`);
  }));
  return { grouped, ungrouped, notes };
}

function serverOne(tick: number, settings: SoGroupingSettings): V09Scenario {
  const p = (tick * 0.0035) % 1;
  const siMembers: V09Vehicle[] = [
    { id: 101, typeId: TYPE_IDS[0], phase: p, routeKey: "si-a", ring: "outer", confidence: 98 },
    { id: 102, typeId: TYPE_IDS[1], phase: p + 1 / 3, routeKey: "si-b", ring: "middle", confidence: 97 },
    { id: 103, typeId: TYPE_IDS[2], phase: p + 2 / 3, routeKey: "si-c", ring: "outer", confidence: 96 },
  ];
  const routes: V09RouteShape[] = [
    circleRoute("si-a", { x: 235, y: 285 }, 116, TYPE_IDS[0]),
    circleRoute("si-b", { x: 235, y: 285 }, 82, TYPE_IDS[1]),
    circleRoute("si-c", { x: 235, y: 285 }, 116, TYPE_IDS[2]),
    singleRoute("so-left", { x: 496, y: 356 }, 27, 118, -20, TYPE_IDS[0]),
    doubleRoute("so-double", { x: 650, y: 300 }, 27, 105, 100, 40, -20, TYPE_IDS[1]),
    singleRoute("so-right", { x: 793, y: 352 }, 25, 105, 20, TYPE_IDS[2]),
  ];
  const soCandidates: V09Vehicle[] = [
    { id: 111, typeId: TYPE_IDS[0], phase: p + .06, routeKey: "so-left", confidence: 94 },
    { id: 211, typeId: TYPE_IDS[1], phase: (tick * .00175) % 1 + .55, routeKey: "so-double", confidence: 95 },
    { id: 112, typeId: TYPE_IDS[1], phase: (tick * .00175) % 1 + .10, routeKey: "so-double", confidence: 93 },
    { id: 212, typeId: TYPE_IDS[2], phase: p + .62, routeKey: "so-right", confidence: 92 },
  ];
  const grouping = groupSoCandidates(routes, soCandidates, settings);
  return {
    id: "1", title: "תרחיש בסיס · מבנים יציבים", subtitle: "SI בזוויות 120° + שרשרת SO חוקית יחיד/כפול/יחיד",
    groups: {
      si: { key: "si", id: "SI-01", name: "SI אלפא", family: "SI", members: siMembers, observedAngles: [120, 120], routeScore: 92, periodErrorPct: 2, motionErrorPct: 4, reason: "המבנה יציב והפרשי הזווית בתחום התקין" },
      so: { key: "so", id: "SO-01", name: "SO בראבו", family: "SO", members: grouping.grouped, observedRelations: ["opposite", "same"], routeScore: 86, periodErrorPct: 3, motionErrorPct: 6, reason: "הגאומטריה עומדת בחוקיות הקבוצה; קיים פער תזמון קל בפנייה הרחוקה" },
    }, routes, ungroupedMembers: grouping.ungrouped, groupingNotes: grouping.notes,
    eventNote: "תרחיש בסיס נקי המשמש להשוואת ציון, קיבוץ והצגה.",
  };
}

function serverTwo(tick: number, settings: SoGroupingSettings): V09Scenario {
  const cycle = tick % 240; const p = (tick * .0042) % 1; const joined = cycle >= 70; const disconnected = cycle >= 145 && cycle < 180;
  const siMembers: V09Vehicle[] = [
    { id: 301, typeId: TYPE_IDS[0], phase: p, routeKey: "s2-si-a", ring: "outer", confidence: 93 },
    { id: 302, typeId: TYPE_IDS[0], phase: p + .5, routeKey: "s2-si-b", ring: "inner", confidence: 91 },
    ...(joined ? [{ id: 303, typeId: TYPE_IDS[2], phase: p + .25, routeKey: "s2-si-c", ring: "middle" as const, confidence: 89 }] : []),
  ];
  const routes: V09RouteShape[] = [
    circleRoute("s2-si-a", { x: 230, y: 275 }, 108, TYPE_IDS[0]), circleRoute("s2-si-b", { x: 230, y: 275 }, 58, TYPE_IDS[0]), circleRoute("s2-si-c", { x: 230, y: 275 }, 82, TYPE_IDS[2]),
    singleRoute("s2-so-a", { x: 635, y: 310 }, 28, 150, -8, TYPE_IDS[0]),
    singleRoute("s2-so-b", { x: 635, y: 310 }, 36, 150, -8, TYPE_IDS[1]),
    singleRoute("s2-so-c", { x: 880, y: 240 }, 26, 120, 32, TYPE_IDS[2]),
  ];
  const candidates: V09Vehicle[] = [
    { id: 321, typeId: TYPE_IDS[0], phase: p + .02, routeKey: "s2-so-a", confidence: 90 },
    ...(!disconnected ? [{ id: 421, typeId: TYPE_IDS[1], phase: p + .50, routeKey: "s2-so-b", confidence: 88 }] : []),
    { id: 521, typeId: TYPE_IDS[2], phase: p + .05, routeKey: "s2-so-c", confidence: 87 },
  ];
  const grouping = groupSoCandidates(routes, candidates, settings);
  return {
    id: "2", title: "תרחיש חברות וקיבוץ", subtitle: "הצטרפות/יציאה + שני SO חופפים חוקיים + היפודרום מרוחק שאינו מקובץ",
    groups: {
      si: { key: "si", id: "SI-02", name: "SI בדיקת הצטרפות", family: "SI", members: siMembers, observedAngles: joined ? [90, 90] : [180], routeScore: 84, periodErrorPct: 7, motionErrorPct: 9, reason: joined ? "רכב חדש נמצא בחלון האישור לפני שינוי חברות" : "קבוצה בת שני רכבים יציבה" },
      so: { key: "so", id: "SO-02", name: "SO חופפים", family: "SO", members: grouping.grouped, observedRelations: ["same"], routeScore: disconnected ? 62 : 80, periodErrorPct: disconnected ? 16 : 8, motionErrorPct: 11, reason: disconnected ? "קיים פער נתונים זמני; נשמרת חברות לפי זמן ההחזקה" : "רק ההיפודרומים החופפים עומדים בחוקיות הקבוצה" },
    }, routes, ungroupedMembers: grouping.ungrouped, groupingNotes: grouping.notes,
    eventNote: disconnected ? "רכב 421 מנותק זמנית; חלון שמירת החברות עדיין פעיל." : joined ? "רכב 303 הצטרף; חלון האישור פעיל." : "לפני הצטרפות הרכב הנוסף.",
  };
}

function serverThree(tick: number, settings: SoGroupingSettings): V09Scenario {
  const cycle = tick % 300; const p = (tick * (cycle > 130 ? .0052 : .0041)) % 1; const transition = cycle >= 190; const drift = cycle >= 110 ? 22 : 4;
  const siMembers: V09Vehicle[] = [
    { id: 601, typeId: TYPE_IDS[2], phase: p, routeKey: "s3-si-a", ring: "outer", confidence: 89 },
    { id: 602, typeId: TYPE_IDS[1], phase: p + .34, routeKey: "s3-si-b", ring: "middle", confidence: 88 },
    { id: 603, typeId: TYPE_IDS[0], phase: p + .69, routeKey: "s3-si-c", ring: "outer", confidence: 86 },
  ];
  const routes: V09RouteShape[] = transition ? [
    circleRoute("s3-si-a", { x: 250, y: 285 }, 118, TYPE_IDS[2]), circleRoute("s3-si-b", { x: 250, y: 285 }, 82, TYPE_IDS[1]), circleRoute("s3-si-c", { x: 250, y: 285 }, 118, TYPE_IDS[0]),
    circleRoute("s3-transition-a", { x: 725, y: 270 }, 105, TYPE_IDS[0]), circleRoute("s3-transition-b", { x: 725, y: 270 }, 82, TYPE_IDS[1]),
  ] : [
    circleRoute("s3-si-a", { x: 250, y: 285 }, 118, TYPE_IDS[2]), circleRoute("s3-si-b", { x: 250, y: 285 }, 82, TYPE_IDS[1]), circleRoute("s3-si-c", { x: 250, y: 285 }, 118, TYPE_IDS[0]),
    doubleRoute("s3-double", { x: 650, y: 285 }, 30, 118, 106, 40, 8, TYPE_IDS[0]),
    singleRoute("s3-right", { x: 752, y: 398 }, 24, 92, 48, TYPE_IDS[2]),
  ];
  const candidates: V09Vehicle[] = transition ? [
    { id: 611, typeId: TYPE_IDS[0], phase: p, routeKey: "s3-transition-a", ring: "outer", confidence: 84 },
    { id: 612, typeId: TYPE_IDS[1], phase: p + .5, routeKey: "s3-transition-b", ring: "outer", confidence: 83 },
  ] : [
    { id: 611, typeId: TYPE_IDS[0], phase: (tick * .00205) % 1, routeKey: "s3-double", confidence: 86 },
    { id: 612, typeId: TYPE_IDS[1], phase: (tick * .00205) % 1 + .5, routeKey: "s3-double", confidence: 85 },
    { id: 613, typeId: TYPE_IDS[2], phase: p + .24, routeKey: "s3-right", confidence: 82 },
  ];
  const grouping = transition ? { grouped: candidates, ungrouped: [] as V09Vehicle[], notes: ["הקבוצה נמצאת במעבר משפחת נתיב ולכן מוצגת כמעבר ולא כקיבוץ SO חדש."] } : groupSoCandidates(routes, candidates, settings);
  return {
    id: "3", title: "תרחיש שינוי מסלול", subtitle: "שינוי זמן מחזור +22% · Double+Single חוקיים גאומטרית · מעבר SO→SI",
    groups: {
      si: { key: "si", id: "SI-03", name: "SI עומס", family: "SI", members: siMembers, observedAngles: [122, 126], routeScore: 78, periodErrorPct: drift, motionErrorPct: 14, reason: drift >= 20 ? "זוהה שינוי מהותי בזמן המחזור הדורש אישור" : "רמת רעש גבוהה אך הקבוצה עדיין יציבה" },
      so: { key: "so", id: "SO-03", name: transition ? "מעבר SO ל־SI" : "SO Double+Single", family: "SO", members: grouping.grouped, observedRelations: transition ? ["opposite"] : ["mixed", "opposite"], routeScore: transition ? 70 : 76, periodErrorPct: drift, motionErrorPct: 15, reason: transition ? "כל חברי הקבוצה משנים יחד את משפחת הנתיב" : "ה־Double וה־Single עומדים בסף החזית והמרחק המקביל המוגדר" },
    }, routes, ungroupedMembers: grouping.ungrouped, groupingNotes: grouping.notes,
    eventNote: transition ? "זוהה מעבר משותף של הקבוצה מ־SO ל־SI." : drift >= 20 ? "שינוי זמן המחזור חצה 20% ונמצא בתהליך אישור כאירוע." : "לפני שינוי זמן המחזור.",
  };
}

export function getV09Scenario(serverId: string, tick = 0, groupingSettings: SoGroupingSettings = DEFAULT_SO_GROUPING): V09Scenario {
  if (serverId === "2") return serverTwo(tick, groupingSettings);
  if (serverId === "3") return serverThree(tick, groupingSettings);
  return serverOne(tick, groupingSettings);
}

/** @deprecated v1.3 uses navigation-derived history from nav-engine.ts. */
export type TimelinePoint = { minute: number; si: { total: number; sync: number; route: number }; so: { total: number; sync: number; route: number } };
export function v09ScoreSeries(serverId: string, minutes = 120): TimelinePoint[] {
  return Array.from({ length: minutes + 1 }, (_, minute) => { const scenario = getV09Scenario(serverId, minute * 60); const legacy = (group: V09Group) => ({ sync: 0, route: Math.round(group.routeScore), total: 0 }); return { minute, si: legacy(scenario.groups.si), so: legacy(scenario.groups.so) }; });
}
