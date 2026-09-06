import type { ScoreThresholds, ScoreWeights, SoRelation, SyncTemplate } from "@/lib/bluewolf";
import { siTemplateScores, soTemplateScores, transferScore, type ScoreTriple } from "../v09/scoring";
import { DEFAULT_SO_GROUPING, largestCompatibleComponent, type SoGeometryDescriptor, type SoGroupingSettings } from "../v10/grouping";
import type { NavigationDataset, NavigationProvenance, RawNavigationSample } from "./navigation-data";

export type DerivedRouteKind = "circle" | "single" | "double";
export type DerivedWindEstimate = { speedKnots: number; bearingDeg: number; confidencePct: number; residualNorth: number; residualEast: number };
export type DerivedVehicleEvidence = {
  id: number; kind: DerivedRouteKind; routeScore: number; sync: number; total: number; routeDeviation: number; tangentErrorDeg: number;
  periodSec: number | null; periodErrorPct: number; motionErrorPct: number; phase: number; direction: 1 | -1; wind: DerivedWindEstimate;
};
export type DerivedRoute = {
  key: string; vehicleId: number; kind: DerivedRouteKind; points: { x: number; y: number }[]; geometry?: SoGeometryDescriptor;
  centerMetric: { x: number; y: number }; rotationDeg: number; radius: number; legLength: number; periodSec: number | null;
};
export type DerivedGroup = {
  key: "si" | "so"; id: string; name: string; family: "SI" | "SO"; members: number[]; score: ScoreTriple; routeScore: number;
  observedAngles: number[]; observedRelations: SoRelation[]; periodErrorPct: number; motionErrorPct: number; vehicles: Record<number, DerivedVehicleEvidence>;
};
export type DerivedAlert = { id: string; severity: "info" | "warning" | "critical"; title: string; detail: string; vehicleIds: number[]; evidence: string[] };
export type NavigationDerivedAnalysis = {
  available: boolean; provenance: NavigationProvenance; routes: DerivedRoute[]; groups: { si: DerivedGroup; so: DerivedGroup }; ungroupedVehicles: number[];
  current: Record<number, { x: number; y: number; headingDeg: number; latitude: number; longitude: number; timestamp: string }>;
  alerts: DerivedAlert[]; groupingNotes: string[];
};

const EMPTY_SCORE: ScoreTriple = { total: 0, sync: 0, route: 0, position: 0, period: 0, motion: 0, distance: 0, tangent: 0, curvature: 0 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const wrap360 = (value: number) => ((value % 360) + 360) % 360;
const wrap180 = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const axisDiff = (a: number, b: number) => { const d = Math.abs(wrap180(a - b)); return Math.min(d, Math.abs(180 - d)); };
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function scoreWeighted(values: number[], weights: number[]) {
  const w = weights.map((value) => Math.max(0, value)); const total = w.reduce((a, b) => a + b, 0); if (!total) return 0;
  return values.reduce((sum, value, index) => sum + value * (w[index] ?? 0), 0) / total;
}

function groupByVehicle(samples: RawNavigationSample[]) {
  const grouped = new Map<number, RawNavigationSample[]>();
  for (const sample of samples) if (sample.active) { const list = grouped.get(sample.vehicleId) ?? []; list.push(sample); grouped.set(sample.vehicleId, list); }
  for (const list of grouped.values()) list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return grouped;
}

function pca(points: { x: number; y: number }[]) {
  const cx = mean(points.map((p) => p.x)); const cy = mean(points.map((p) => p.y));
  let xx = 0, yy = 0, xy = 0;
  for (const p of points) { const dx = p.x - cx, dy = p.y - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const n = Math.max(1, points.length); xx /= n; yy /= n; xy /= n;
  const theta = .5 * Math.atan2(2 * xy, xx - yy); const ux = Math.cos(theta), uy = Math.sin(theta); const vx = -uy, vy = ux;
  const proj = points.map((p) => ({ u: (p.x - cx) * ux + (p.y - cy) * uy, v: (p.x - cx) * vx + (p.y - cy) * vy }));
  const minU = Math.min(...proj.map((p) => p.u)), maxU = Math.max(...proj.map((p) => p.u)), minV = Math.min(...proj.map((p) => p.v)), maxV = Math.max(...proj.map((p) => p.v));
  return { center: { x: cx, y: cy }, theta, rotationDeg: theta * 180 / Math.PI, ux, uy, vx, vy, proj, minU, maxU, minV, maxV, majorSpan: maxU - minU, minorSpan: maxV - minV };
}

function currentHeading(sample: RawNavigationSample) { return wrap360(Math.atan2(sample.velocityEast, sample.velocityNorth) * 180 / Math.PI); }

function straightBandCount(samples: RawNavigationSample[], fit: ReturnType<typeof pca>) {
  const bands: number[] = [];
  for (let i = 0; i < samples.length; i += Math.max(1, Math.floor(samples.length / 180))) {
    const sample = samples[i]; const speed = Math.hypot(sample.velocityEast, sample.velocityNorth); if (speed < .5) continue;
    const headingAxis = Math.atan2(sample.velocityNorth, sample.velocityEast) * 180 / Math.PI;
    const majorAxis = fit.rotationDeg;
    if (axisDiff(headingAxis, majorAxis) > 28) continue;
    bands.push(fit.proj[i]?.v ?? 0);
  }
  if (bands.length < 8) return 2;
  bands.sort((a, b) => a - b); const tolerance = Math.max(6, fit.minorSpan * .18); let clusters = 1;
  for (let i = 1; i < bands.length; i++) if (bands[i] - bands[i - 1] > tolerance) clusters += 1;
  return clusters;
}

function estimateKind(samples: RawNavigationSample[], fit: ReturnType<typeof pca>): DerivedRouteKind {
  const aspect = fit.majorSpan / Math.max(1, fit.minorSpan);
  if (aspect < 1.32) return "circle";
  return straightBandCount(samples, fit) >= 3 ? "double" : "single";
}

function meanSpeed(samples: RawNavigationSample[]) { return median(samples.map((s) => Math.hypot(s.velocityEast, s.velocityNorth)).filter((v) => Number.isFinite(v) && v > .1)); }

function routeLength(kind: DerivedRouteKind, fit: ReturnType<typeof pca>) {
  if (kind === "circle") return 2 * Math.PI * Math.max(1, (fit.majorSpan + fit.minorSpan) / 4);
  const radius = Math.max(1, fit.minorSpan / 2); const leg = Math.max(1, fit.majorSpan - 2 * radius);
  return kind === "double" ? 2 * (2 * leg + 2 * Math.PI * radius) : 2 * leg + 2 * Math.PI * radius;
}

function routePeriod(kind: DerivedRouteKind, fit: ReturnType<typeof pca>, samples: RawNavigationSample[]) {
  const speed = meanSpeed(samples); return speed > .15 ? routeLength(kind, fit) / speed : null;
}

function phaseAndDirection(kind: DerivedRouteKind, fit: ReturnType<typeof pca>, sample: RawNavigationSample) {
  const dx = sample.x - fit.center.x, dy = sample.y - fit.center.y;
  if (kind === "circle") {
    const angle = Math.atan2(dy, dx); const tangentEast = -Math.sin(angle), tangentNorth = Math.cos(angle); const dot = sample.velocityEast * tangentEast + sample.velocityNorth * tangentNorth; const direction: 1 | -1 = dot >= 0 ? 1 : -1;
    const raw = wrap360(angle * 180 / Math.PI) / 360; return { phase: direction === 1 ? raw : (1 - raw) % 1, direction };
  }
  const u = dx * fit.ux + dy * fit.uy; const v = dx * fit.vx + dy * fit.vy; const uNorm = clamp((u - fit.minU) / Math.max(1e-6, fit.maxU - fit.minU), 0, 1);
  const along = sample.velocityEast * fit.ux + sample.velocityNorth * fit.uy; const side = v >= 0 ? 1 : -1; const direction: 1 | -1 = side > 0 ? (along >= 0 ? 1 : -1) : (along <= 0 ? 1 : -1);
  let phase = side > 0 ? uNorm * .5 : .5 + (1 - uNorm) * .5; if (direction === -1) phase = (1 - phase) % 1;
  if (kind === "double") phase = (phase * 2) % 1;
  return { phase, direction };
}

function nearestDistanceAndHeading(samples: RawNavigationSample[], current: RawNavigationSample) {
  const training = samples.slice(0, Math.max(3, Math.floor(samples.length * .8))); let best = Infinity, heading = currentHeading(current);
  for (let i = 0; i < training.length - 1; i++) {
    const a = training[i], b = training[i + 1]; const d = Math.hypot(current.x - a.x, current.y - a.y);
    if (d < best) { best = d; heading = wrap360(Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI); }
  }
  return { distance: Number.isFinite(best) ? best : 0, heading };
}

function routeEvidence(samples: RawNavigationSample[], current: RawNavigationSample, fit: ReturnType<typeof pca>, kind: DerivedRouteKind, thresholds: ScoreThresholds, weights: ScoreWeights) {
  const nearest = nearestDistanceAndHeading(samples, current); const tangentErrorDeg = Math.abs(wrap180(currentHeading(current) - nearest.heading));
  const radius = Math.max(5, kind === "circle" ? (fit.majorSpan + fit.minorSpan) / 4 : fit.minorSpan / 2); const distancePct = nearest.distance / radius * 100;
  const distanceScore = transferScore(distancePct, thresholds.routeDistanceFullPct, thresholds.routeDistanceZeroPct);
  const tangentScore = transferScore(tangentErrorDeg, thresholds.tangentFullDeg, thresholds.tangentZeroDeg);
  const aspectErrorPct = kind === "circle" ? Math.abs(fit.majorSpan - fit.minorSpan) / Math.max(1, (fit.majorSpan + fit.minorSpan) / 2) * 100 : 0;
  const curvatureScore = transferScore(aspectErrorPct, thresholds.curvatureFullPct, thresholds.curvatureZeroPct);
  return { routeScore: scoreWeighted([distanceScore, tangentScore, curvatureScore], [weights.route.distance, weights.route.tangent, weights.route.curvature]), routeDeviation: nearest.distance, tangentErrorDeg };
}

function windEstimate(samples: RawNavigationSample[], current: RawNavigationSample, fit: ReturnType<typeof pca>, kind: DerivedRouteKind, phase: number, direction: 1 | -1, routeScore: number, provenance: NavigationProvenance): DerivedWindEstimate {
  const speed = meanSpeed(samples); let expectedEast = 0, expectedNorth = 0;
  if (kind === "circle") {
    const dx = current.x - fit.center.x, dy = current.y - fit.center.y, length = Math.max(1e-6, Math.hypot(dx, dy)); const rx = dx / length, ry = dy / length;
    expectedEast = -ry * speed * direction; expectedNorth = rx * speed * direction;
  } else {
    const alongSign = Math.sign(current.velocityEast * fit.ux + current.velocityNorth * fit.uy) || 1; expectedEast = fit.ux * speed * alongSign; expectedNorth = fit.uy * speed * alongSign;
  }
  const residualEast = current.velocityEast - expectedEast, residualNorth = current.velocityNorth - expectedNorth; const mps = Math.hypot(residualEast, residualNorth);
  const confidence = clamp((routeScore * .72 + (provenance.completenessPct ?? 75) * .28) * (samples.length >= 8 ? 1 : .65), 0, 99);
  return { speedKnots: mps * 1.9438444924406, bearingDeg: mps < .05 ? 0 : wrap360(Math.atan2(residualEast, residualNorth) * 180 / Math.PI), confidencePct: confidence, residualNorth, residualEast };
}

type Track = {
  id: number; samples: RawNavigationSample[]; current: RawNavigationSample; fit: ReturnType<typeof pca>; kind: DerivedRouteKind; phase: number; direction: 1 | -1;
  periodSec: number | null; routeScore: number; routeDeviation: number; tangentErrorDeg: number; geometry?: SoGeometryDescriptor;
};

function buildTrack(id: number, samples: RawNavigationSample[], provenance: NavigationProvenance, thresholds: ScoreThresholds, weights: ScoreWeights): Track | null {
  if (samples.length < 4) return null; const current = samples.at(-1)!; const points = samples.map((sample) => ({ x: sample.x, y: sample.y })); const fit = pca(points); const kind = estimateKind(samples, fit);
  const pd = phaseAndDirection(kind, fit, current); const route = routeEvidence(samples, current, fit, kind, thresholds, weights); const periodSec = routePeriod(kind, fit, samples);
  const radius = Math.max(5, kind === "circle" ? (fit.majorSpan + fit.minorSpan) / 4 : fit.minorSpan / 2); const legLength = Math.max(1, fit.majorSpan - 2 * radius);
  const geometry = kind === "circle" ? undefined : { kind, center: fit.center, radius, legLength, rotationDeg: fit.rotationDeg, ...(kind === "double" ? { secondLegLength: legLength, bendDeg: 28 } : {}) } satisfies SoGeometryDescriptor;
  return { id, samples, current, fit, kind, phase: pd.phase, direction: pd.direction, periodSec, routeScore: route.routeScore, routeDeviation: route.routeDeviation, tangentErrorDeg: route.tangentErrorDeg, geometry };
}

function classifyPhase(diff: number): SoRelation { const d = ((diff % 1) + 1) % 1; const same = Math.min(d, 1 - d), opposite = Math.abs(d - .5); return same <= .125 ? "same" : opposite <= .125 ? "opposite" : "mixed"; }
function templateRelations(template: SyncTemplate | undefined): SoRelation[] { if (template?.soSpec?.relations?.length) return template.soSpec.relations; return (template?.values ?? []).map((v) => v === 0 ? "same" : v === 2 ? "opposite" : "mixed"); }

function displayTransform(tracks: Track[]) {
  const points = tracks.flatMap((track) => track.samples.map((s) => ({ x: s.x, y: s.y }))); if (!points.length) return (p: { x: number; y: number }) => ({ x: 500, y: 285 });
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const spanX = Math.max(80, maxX - minX), spanY = Math.max(60, maxY - minY), scale = Math.min(820 / spanX, 450 / spanY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return (p: { x: number; y: number }) => ({ x: 500 + (p.x - cx) * scale, y: 285 - (p.y - cy) * scale });
}

function downsamplePath(samples: RawNavigationSample[], transform: ReturnType<typeof displayTransform>) {
  const step = Math.max(1, Math.floor(samples.length / 100)); return samples.filter((_, index) => index % step === 0).map((s) => transform(s));
}

function periodStats(tracks: Track[]) {
  const periods = tracks.map((track) => track.periodSec).filter((value): value is number => value != null && Number.isFinite(value)); const avg = mean(periods); const speeds = tracks.map((track) => meanSpeed(track.samples)); const avgSpeed = mean(speeds);
  return {
    periodErrorPct: avg > 0 ? mean(periods.map((value) => Math.abs(value - avg) / avg * 100)) : 0,
    motionErrorPct: avgSpeed > 0 ? mean(speeds.map((value) => Math.abs(value - avgSpeed) / avgSpeed * 100)) : 0,
    meanPeriod: avg,
  };
}

function siObservedAngles(tracks: Track[]) {
  if (tracks.length < 2) return []; const center = { x: mean(tracks.map((t) => t.fit.center.x)), y: mean(tracks.map((t) => t.fit.center.y)) };
  const ordered = [...tracks].sort((a, b) => a.id - b.id);
  return ordered.slice(0, -1).map((track, index) => { const next = ordered[index + 1]; const a = Math.atan2(track.current.y - center.y, track.current.x - center.x) * 180 / Math.PI; const b = Math.atan2(next.current.y - center.y, next.current.x - center.x) * 180 / Math.PI; return Math.abs(wrap180(b - a)); });
}

function groupVehicleScores(tracks: Track[], groupScore: ScoreTriple, timing: ReturnType<typeof periodStats>, provenance: NavigationProvenance, thresholds: ScoreThresholds, weights: ScoreWeights) {
  const out: Record<number, DerivedVehicleEvidence> = {};
  for (const track of tracks) {
    const periodErrorPct = track.periodSec && timing.meanPeriod ? Math.abs(track.periodSec - timing.meanPeriod) / timing.meanPeriod * 100 : 0; const speed = meanSpeed(track.samples); const avgSpeed = mean(tracks.map((t) => meanSpeed(t.samples))); const motionErrorPct = avgSpeed > 0 ? Math.abs(speed - avgSpeed) / avgSpeed * 100 : 0;
    const period = transferScore(periodErrorPct, thresholds.periodFullPct, thresholds.periodZeroPct), motion = transferScore(motionErrorPct, thresholds.motionFullPct, thresholds.motionZeroPct);
    const sync = scoreWeighted([groupScore.position, period, motion], [weights.sync.position, weights.sync.period, weights.sync.motion]); const total = scoreWeighted([sync, track.routeScore], [weights.total.sync, weights.total.route]);
    out[track.id] = { id: track.id, kind: track.kind, routeScore: Math.round(track.routeScore), sync: Math.round(sync), total: Math.round(total), routeDeviation: track.routeDeviation, tangentErrorDeg: track.tangentErrorDeg, periodSec: track.periodSec, periodErrorPct, motionErrorPct, phase: track.phase, direction: track.direction, wind: windEstimate(track.samples, track.current, track.fit, track.kind, track.phase, track.direction, track.routeScore, provenance) };
  }
  return out;
}

function emptyGroup(key: "si" | "so"): DerivedGroup { return { key, id: key === "si" ? "SI-NODATA" : "SO-NODATA", name: key === "si" ? "SI" : "SO", family: key === "si" ? "SI" : "SO", members: [], score: EMPTY_SCORE, routeScore: 0, observedAngles: [], observedRelations: [], periodErrorPct: 0, motionErrorPct: 0, vehicles: {} }; }

function alertsFromAnalysis(groups: { si: DerivedGroup; so: DerivedGroup }, ungrouped: number[], provenance: NavigationProvenance, thresholds: ScoreThresholds) {
  const alerts: DerivedAlert[] = [];
  if (!provenance.sampleCount) return [{ id: "no-data", severity: "critical", title: "אין נתוני ניווט", detail: "לא התקבלו דגימות בטווח המבוקש ולכן לא חושבו ציונים, קבוצות או שערוך רוח.", vehicleIds: [], evidence: provenance.warnings }];
  if ((provenance.completenessPct ?? 100) < 80) alerts.push({ id: "data-gaps", severity: "warning", title: "שלמות נתונים נמוכה", detail: `שלמות הדגימות המחושבת היא ${(provenance.completenessPct ?? 0).toFixed(1)}%. יש לפרש ציונים ואירועים בזהירות.`, vehicleIds: [], evidence: [`${provenance.sampleCount} דגימות`, `מרווח חציוני ${provenance.samplingMedianSeconds?.toFixed(1) ?? "—"} שנ׳`] });
  if (ungrouped.length) alerts.push({ id: "ungrouped", severity: "warning", title: "רכבים מחוץ לקבוצת SO", detail: `הרכבים ${ungrouped.join(", ")} אינם מקיימים את חוקיות הקיבוץ הגאומטרית ולכן אינם משתתפים בציון הקבוצה.`, vehicleIds: ungrouped, evidence: [] });
  for (const key of ["si", "so"] as const) {
    const group = groups[key]; if (!group.members.length) continue;
    if (group.periodErrorPct > thresholds.periodFullPct) alerts.push({ id: `${key}-period`, severity: group.periodErrorPct >= thresholds.periodZeroPct ? "critical" : "warning", title: `שינוי זמן מחזור בקבוצת ${key.toUpperCase()}`, detail: `פער זמן המחזור שנגזר מהניווט הוא ${group.periodErrorPct.toFixed(1)}%. סף מלא ${thresholds.periodFullPct}% וסף אפס ${thresholds.periodZeroPct}%.`, vehicleIds: group.members, evidence: [`Sync ${group.score.sync}`, `Period component ${group.score.period}`] });
    const worst = Object.values(group.vehicles).sort((a, b) => b.routeDeviation - a.routeDeviation)[0];
    if (worst && worst.routeDeviation > 12) alerts.push({ id: `${key}-route-${worst.id}`, severity: worst.routeDeviation > 30 ? "critical" : "warning", title: `סטיית נתיב ברכב ${worst.id}`, detail: `הסטייה הנוכחית מהתוואי הנלמד היא ${worst.routeDeviation.toFixed(1)} מ׳; ציון הנתיב של הרכב ${worst.routeScore}.`, vehicleIds: [worst.id], evidence: [`שגיאת משיק ${worst.tangentErrorDeg.toFixed(1)}°`, `Route ${worst.routeScore}`] });
  }
  if (!alerts.length) alerts.push({ id: "stable", severity: "info", title: "אין חריגה מאושרת כרגע", detail: "הציונים, זמני המחזור והסטיות המחושבים מהניווט נמצאים בתחום התקין של הספים המוגדרים.", vehicleIds: [], evidence: [] });
  return alerts;
}

export function analyzeNavigationDataset(dataset: NavigationDataset, { thresholds, weights, siTemplate, soTemplate, groupingSettings = DEFAULT_SO_GROUPING }: { thresholds: ScoreThresholds; weights: ScoreWeights; siTemplate?: SyncTemplate; soTemplate?: SyncTemplate; groupingSettings?: SoGroupingSettings }): NavigationDerivedAnalysis {
  const byVehicle = groupByVehicle(dataset.samples); const tracks = [...byVehicle.entries()].map(([id, samples]) => buildTrack(id, samples, dataset.provenance, thresholds, weights)).filter((track): track is Track => Boolean(track));
  if (!tracks.length) { const groups = { si: emptyGroup("si"), so: emptyGroup("so") }; return { available: false, provenance: dataset.provenance, routes: [], groups, ungroupedVehicles: [], current: {}, alerts: alertsFromAnalysis(groups, [], dataset.provenance, thresholds), groupingNotes: [] }; }
  const transform = displayTransform(tracks); const circles = tracks.filter((track) => track.kind === "circle"); const soTracks = tracks.filter((track) => track.kind !== "circle" && track.geometry);
  // SI grouping: common-center circles + broadly compatible period. Keep largest center-compatible component.
  const siTracks = circles.filter((track) => circles.every((other) => track === other || distance(track.fit.center, other.fit.center) <= Math.max(track.fit.minorSpan, other.fit.minorSpan) * .7));
  const soCandidates = soTracks.map((track) => ({ track, geometry: track.geometry! })); const groupedSo = largestCompatibleComponent(soCandidates, groupingSettings); const groupedSoIds = new Set(groupedSo.grouped.map((item) => item.track.id));
  const activeSo = soTracks.filter((track) => groupedSoIds.has(track.id)); const ungrouped = soTracks.filter((track) => !groupedSoIds.has(track.id)).map((track) => track.id);
  const groupingNotes: string[] = []; for (const [key, evidence] of groupedSo.pairEvidence) groupingNotes.push(`${key}: ${evidence.explanation}`);

  const siTiming = periodStats(siTracks), soTiming = periodStats(activeSo); const siAngles = siObservedAngles(siTracks);
  const orderedSo = [...activeSo].sort((a, b) => a.fit.center.x - b.fit.center.x || a.id - b.id); const soRelations = orderedSo.slice(0, -1).map((track, index) => classifyPhase(orderedSo[index + 1].phase - track.phase));
  const siRouteScore = mean(siTracks.map((track) => track.routeScore)), soRouteScore = mean(activeSo.map((track) => track.routeScore));
  const siScore = siTracks.length ? siTemplateScores(siAngles, siTemplate?.values ?? [120, 120], thresholds, weights, siRouteScore, siTiming.periodErrorPct, siTiming.motionErrorPct) : EMPTY_SCORE;
  const soScore = activeSo.length ? soTemplateScores(soRelations, templateRelations(soTemplate), thresholds, weights, soRouteScore, soTiming.periodErrorPct, soTiming.motionErrorPct) : EMPTY_SCORE;
  const groups: { si: DerivedGroup; so: DerivedGroup } = {
    si: { key: "si", id: "SI-NAV", name: "קבוצת SI", family: "SI", members: siTracks.map((t) => t.id), score: siScore, routeScore: siRouteScore, observedAngles: siAngles, observedRelations: [], periodErrorPct: siTiming.periodErrorPct, motionErrorPct: siTiming.motionErrorPct, vehicles: groupVehicleScores(siTracks, siScore, siTiming, dataset.provenance, thresholds, weights) },
    so: { key: "so", id: "SO-NAV", name: "קבוצת SO", family: "SO", members: activeSo.map((t) => t.id), score: soScore, routeScore: soRouteScore, observedAngles: [], observedRelations: soRelations, periodErrorPct: soTiming.periodErrorPct, motionErrorPct: soTiming.motionErrorPct, vehicles: groupVehicleScores(activeSo, soScore, soTiming, dataset.provenance, thresholds, weights) },
  };
  const routes: DerivedRoute[] = tracks.map((track) => ({ key: `nav-${track.id}`, vehicleId: track.id, kind: track.kind, points: downsamplePath(track.samples, transform), geometry: track.geometry, centerMetric: track.fit.center, rotationDeg: track.fit.rotationDeg, radius: Math.max(5, track.kind === "circle" ? (track.fit.majorSpan + track.fit.minorSpan) / 4 : track.fit.minorSpan / 2), legLength: Math.max(1, track.fit.majorSpan - track.fit.minorSpan), periodSec: track.periodSec }));
  const current = Object.fromEntries(tracks.map((track) => { const p = transform(track.current); return [track.id, { x: p.x, y: p.y, headingDeg: currentHeading(track.current), latitude: track.current.latitude, longitude: track.current.longitude, timestamp: track.current.timestamp }]; }));
  return { available: true, provenance: dataset.provenance, routes, groups, ungroupedVehicles: ungrouped, current, alerts: alertsFromAnalysis(groups, ungrouped, dataset.provenance, thresholds), groupingNotes };
}

export function compareMembership(a: NavigationDerivedAnalysis, b: NavigationDerivedAnalysis) {
  const change = (key: "si" | "so") => { const before = new Set(a.groups[key].members), after = new Set(b.groups[key].members); return { joined: [...after].filter((id) => !before.has(id)), left: [...before].filter((id) => !after.has(id)) }; };
  return { si: change("si"), so: change("so") };
}
