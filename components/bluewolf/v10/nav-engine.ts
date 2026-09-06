import type { ScoreThresholds, ScoreWeights, SoRelation, SyncTemplate } from "@/lib/bluewolf";
import { distance, pointOnClosed, type DirectedPoint } from "../v09/geometry";
import { siTemplateScores, soTemplateScores, transferScore, type ScoreTriple } from "../v09/scoring";
import { getV09Scenario, type V09RouteShape, type V09Vehicle } from "../v09/simulator";
import { DEFAULT_SO_GROUPING, type SoGroupingSettings } from "./grouping";
import { windOffsetPx, type WindMode } from "./wind";

export type NavigationEvidence = {
  vehicleId: number;
  routeKey: string;
  x: number;
  y: number;
  heading: number;
  idealX: number;
  idealY: number;
  idealHeading: number;
  nearestPhase: number;
  routeDeviation: number;
  tangentErrorDeg: number;
  curvatureErrorPct: number;
  normalizedRate: number;
  normalizedPeriod: number;
};

export type VehicleScoreEvidence = {
  id: number;
  total: number;
  sync: number;
  routeDeviation: number;
  tangentErrorDeg: number;
  periodErrorPct: number;
  motionErrorPct: number;
};

export type NavigationGroupAnalysis = {
  score: ScoreTriple;
  observedAngles: number[];
  observedRelations: SoRelation[];
  routeScore: number;
  periodErrorPct: number;
  motionErrorPct: number;
  vehicles: Record<number, VehicleScoreEvidence>;
};

export type NavigationAnalysis = {
  scenario: ReturnType<typeof getV09Scenario>;
  nav: Record<number, NavigationEvidence>;
  si: NavigationGroupAnalysis;
  so: NavigationGroupAnalysis;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wrap180 = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const angleError = (a: number, b: number) => Math.abs(wrap180(a - b));
const circularAdvance = (current: number, previous: number) => ((current - previous) % 1 + 1) % 1;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
function weighted(values: number[], weights: number[]) { const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0); return total ? values.reduce((sum, value, index) => sum + value * Math.max(0, weights[index] ?? 0), 0) / total : 0; }

function routeRadius(route: V09RouteShape) {
  if (route.geometry?.radius) return route.geometry.radius;
  const xs = route.points.map((p) => p.x); const ys = route.points.map((p) => p.y);
  return Math.max(8, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2);
}

function nearestOnRoute(route: V09RouteShape, x: number, y: number) {
  let bestIndex = 0; let bestDistance = Infinity;
  route.points.forEach((point, index) => { const d = Math.hypot(point.x - x, point.y - y); if (d < bestDistance) { bestDistance = d; bestIndex = index; } });
  const a = route.points[bestIndex]; const b = route.points[(bestIndex + 1) % route.points.length];
  const heading = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90;
  return { phase: bestIndex / Math.max(1, route.points.length), distance: bestDistance, heading };
}

function centerOfRoute(route: V09RouteShape) {
  if (route.geometry) return route.geometry.center;
  return { x: mean(route.points.map((p) => p.x)), y: mean(route.points.map((p) => p.y)) };
}

function deterministicNoise(serverId: string, tick: number, vehicleId: number) {
  const stress = serverId === "3" ? 3.8 : serverId === "2" ? 2.4 : 1.2;
  const seed = vehicleId * .071 + Number(serverId) * 1.9;
  return {
    x: stress * Math.sin(tick / 19 + seed),
    y: stress * .75 * Math.cos(tick / 17 + seed * 1.3),
    heading: stress * .45 * Math.sin(tick / 13 + seed * .7),
  };
}

function navPoint(serverId: string, tick: number, member: V09Vehicle, route: V09RouteShape, windMode: WindMode): NavigationEvidence {
  const ideal = pointOnClosed(route.points, member.phase);
  const previousScenario = getV09Scenario(serverId, tick - 5);
  const previousMember = [...previousScenario.groups.si.members, ...previousScenario.groups.so.members, ...(previousScenario.ungroupedMembers ?? [])].find((item) => item.id === member.id);
  const previousRoute = previousMember ? previousScenario.routes.find((item) => item.key === previousMember.routeKey) : undefined;
  const previousIdeal = previousMember && previousRoute ? pointOnClosed(previousRoute.points, previousMember.phase) : ideal;
  const noise = deterministicNoise(serverId, tick, member.id); const wind = windOffsetPx(serverId, tick, member.id, windMode);
  const x = ideal.x + noise.x + wind.x; const y = ideal.y + noise.y + wind.y; const heading = ideal.heading + noise.heading;
  const nearest = nearestOnRoute(route, x, y);
  const previousNoise = deterministicNoise(serverId, tick - 5, member.id); const previousWind = windOffsetPx(serverId, tick - 5, member.id, windMode);
  const previousHeading = previousIdeal.heading + previousNoise.heading;
  const actualHeadingDelta = angleError(heading, previousHeading); const idealHeadingDelta = angleError(ideal.heading, previousIdeal.heading);
  const curvatureErrorPct = Math.abs(actualHeadingDelta - idealHeadingDelta) / Math.max(5, idealHeadingDelta) * 100;
  const rawAdvance = previousMember ? circularAdvance(member.phase, previousMember.phase) / 5 : 0;
  const normalizedRate = rawAdvance * (route.kind === "double" ? 2 : 1);
  return { vehicleId: member.id, routeKey: member.routeKey, x, y, heading, idealX: ideal.x, idealY: ideal.y, idealHeading: ideal.heading, nearestPhase: nearest.phase, routeDeviation: nearest.distance, tangentErrorDeg: angleError(heading, nearest.heading), curvatureErrorPct, normalizedRate, normalizedPeriod: normalizedRate > 1e-6 ? 1 / normalizedRate : Infinity };
}

function routeScoreFor(nav: NavigationEvidence, route: V09RouteShape, thresholds: ScoreThresholds, weights: ScoreWeights) {
  const radius = routeRadius(route); const distancePct = nav.routeDeviation / Math.max(1, radius) * 100;
  const distanceScore = transferScore(distancePct, thresholds.routeDistanceFullPct, thresholds.routeDistanceZeroPct);
  const tangentScore = transferScore(nav.tangentErrorDeg, thresholds.tangentFullDeg, thresholds.tangentZeroDeg);
  const curvatureScore = transferScore(nav.curvatureErrorPct, thresholds.curvatureFullPct, thresholds.curvatureZeroPct);
  return weighted([distanceScore, tangentScore, curvatureScore], [weights.route.distance, weights.route.tangent, weights.route.curvature]);
}

function siAngles(members: V09Vehicle[], nav: Record<number, NavigationEvidence>, routes: V09RouteShape[]) {
  if (members.length < 2) return [];
  const centers = members.map((member) => centerOfRoute(routes.find((route) => route.key === member.routeKey) ?? routes[0]));
  const center = { x: mean(centers.map((p) => p.x)), y: mean(centers.map((p) => p.y)) };
  return members.slice(0, -1).map((member, index) => {
    const a = nav[member.id]; const b = nav[members[index + 1].id];
    if (!a || !b) return 0;
    const aa = Math.atan2(a.y - center.y, a.x - center.x) * 180 / Math.PI;
    const bb = Math.atan2(b.y - center.y, b.x - center.x) * 180 / Math.PI;
    const raw = Math.abs(wrap180(bb - aa)); return Math.min(raw, 360 - raw);
  });
}

function classifyPhase(diff: number): SoRelation {
  const d = ((diff % 1) + 1) % 1; const sameError = Math.min(d, 1 - d); const oppositeError = Math.abs(d - .5);
  if (sameError <= .125) return "same"; if (oppositeError <= .125) return "opposite"; return "mixed";
}

function soRelations(members: V09Vehicle[], routes: V09RouteShape[]) {
  const routeKeys = [...new Set(members.map((member) => member.routeKey))];
  return routeKeys.slice(0, -1).map((routeKey, index): SoRelation => {
    const nextKey = routeKeys[index + 1]; const aRoute = routes.find((route) => route.key === routeKey); const bRoute = routes.find((route) => route.key === nextKey);
    const aMembers = members.filter((member) => member.routeKey === routeKey); const bMembers = members.filter((member) => member.routeKey === nextKey);
    const labels = aMembers.flatMap((a) => bMembers.map((b) => {
      const aPhase = aRoute?.kind === "double" ? (a.phase * 2) % 1 : a.phase % 1;
      const bPhase = bRoute?.kind === "double" ? (b.phase * 2) % 1 : b.phase % 1;
      return classifyPhase(bPhase - aPhase);
    }));
    return labels.length && labels.every((label) => label === labels[0]) ? labels[0] : "mixed";
  });
}

function decodeRelations(template: SyncTemplate | undefined): SoRelation[] {
  if (template?.soSpec?.relations?.length) return template.soSpec.relations;
  return (template?.values ?? []).map((value) => value === 0 ? "same" : value === 2 ? "opposite" : "mixed");
}

function groupTiming(members: V09Vehicle[], nav: Record<number, NavigationEvidence>) {
  const valid = members.map((member) => nav[member.id]).filter((item) => item && Number.isFinite(item.normalizedPeriod) && item.normalizedRate > 1e-6);
  if (valid.length < 2) return { periodErrorPct: 0, motionErrorPct: 0, meanPeriod: valid[0]?.normalizedPeriod ?? 0, meanRate: valid[0]?.normalizedRate ?? 0 };
  const meanPeriod = mean(valid.map((item) => item.normalizedPeriod)); const meanRate = mean(valid.map((item) => item.normalizedRate));
  const periodErrorPct = mean(valid.map((item) => Math.abs(item.normalizedPeriod - meanPeriod) / Math.max(1e-6, meanPeriod) * 100));
  const motionErrorPct = mean(valid.map((item) => Math.abs(item.normalizedRate - meanRate) / Math.max(1e-6, meanRate) * 100));
  return { periodErrorPct, motionErrorPct, meanPeriod, meanRate };
}

function vehicleScores(members: V09Vehicle[], nav: Record<number, NavigationEvidence>, routes: V09RouteShape[], groupPosition: number, timing: ReturnType<typeof groupTiming>, thresholds: ScoreThresholds, weights: ScoreWeights) {
  return Object.fromEntries(members.map((member) => {
    const evidence = nav[member.id]; const route = routes.find((item) => item.key === member.routeKey) ?? routes[0];
    const routeScore = routeScoreFor(evidence, route, thresholds, weights);
    const periodErrorPct = timing.meanPeriod && Number.isFinite(evidence.normalizedPeriod) ? Math.abs(evidence.normalizedPeriod - timing.meanPeriod) / timing.meanPeriod * 100 : 0;
    const motionErrorPct = timing.meanRate ? Math.abs(evidence.normalizedRate - timing.meanRate) / timing.meanRate * 100 : 0;
    const period = transferScore(periodErrorPct, thresholds.periodFullPct, thresholds.periodZeroPct); const motion = transferScore(motionErrorPct, thresholds.motionFullPct, thresholds.motionZeroPct);
    const sync = weighted([groupPosition, period, motion], [weights.sync.position, weights.sync.period, weights.sync.motion]); const total = weighted([sync, routeScore], [weights.total.sync, weights.total.route]);
    return [member.id, { id: member.id, total: Math.round(total), sync: Math.round(sync), routeDeviation: evidence.routeDeviation, tangentErrorDeg: evidence.tangentErrorDeg, periodErrorPct, motionErrorPct } satisfies VehicleScoreEvidence];
  }));
}

export function analyzeNavigation({ serverId, tick, windMode = "off", thresholds, weights, siTemplate, soTemplate, groupingSettings = DEFAULT_SO_GROUPING }: {
  serverId: string; tick: number; windMode?: WindMode; thresholds: ScoreThresholds; weights: ScoreWeights; siTemplate?: SyncTemplate; soTemplate?: SyncTemplate; groupingSettings?: SoGroupingSettings;
}): NavigationAnalysis {
  const scenario = getV09Scenario(serverId, tick, groupingSettings);
  const allMembers = [...scenario.groups.si.members, ...scenario.groups.so.members, ...(scenario.ungroupedMembers ?? [])]; const nav: Record<number, NavigationEvidence> = {};
  allMembers.forEach((member) => { const route = scenario.routes.find((item) => item.key === member.routeKey); if (route) nav[member.id] = navPoint(serverId, tick, member, route, windMode); });

  const analyze = (key: "si" | "so", template: SyncTemplate | undefined): NavigationGroupAnalysis => {
    const group = scenario.groups[key]; const timing = groupTiming(group.members, nav);
    const routeScores = group.members.map((member) => { const route = scenario.routes.find((item) => item.key === member.routeKey) ?? scenario.routes[0]; return routeScoreFor(nav[member.id], route, thresholds, weights); });
    const routeScore = mean(routeScores); const observedAngles = key === "si" ? siAngles(group.members, nav, scenario.routes) : []; const observedRelations = key === "so" ? soRelations(group.members, scenario.routes) : [];
    const score = key === "si"
      ? siTemplateScores(observedAngles, template?.values ?? [120, 120], thresholds, weights, routeScore, timing.periodErrorPct, timing.motionErrorPct)
      : soTemplateScores(observedRelations, decodeRelations(template), thresholds, weights, routeScore, timing.periodErrorPct, timing.motionErrorPct);
    return { score, observedAngles, observedRelations, routeScore, periodErrorPct: timing.periodErrorPct, motionErrorPct: timing.motionErrorPct, vehicles: vehicleScores(group.members, nav, scenario.routes, score.position, timing, thresholds, weights) };
  };
  return { scenario, nav, si: analyze("si", siTemplate), so: analyze("so", soTemplate) };
}

export function navigationHistory(args: Omit<Parameters<typeof analyzeNavigation>[0], "tick"> & { currentTick: number; minutes: number }) {
  return Array.from({ length: args.minutes + 1 }, (_, index) => {
    const ago = args.minutes - index; const analysis = analyzeNavigation({ ...args, tick: args.currentTick - ago * 60 });
    return { minuteAgo: ago, si: analysis.si.score, so: analysis.so.score };
  });
}
