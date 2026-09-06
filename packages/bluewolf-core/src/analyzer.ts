import { CORE_API_VERSION, DEFAULT_SO_GROUPING, type CoreAnalysis, type CoreConfig, type DerivedAlert, type DerivedGroup, type DerivedRoute, type DerivedVehicleEvidence, type NavigationDataset, type NavigationProvenance, type RawNavigationSample, type RouteKind, type ScoreBreakdown, type SoGeometryDescriptor, type SoRelation } from "./contracts.ts";
import { largestCompatibleComponent } from "./grouping.ts";
import { routeScoreBreakdown, siScores, soScores, transferScore, weighted } from "./scoring.ts";

const EMPTY_SCORE: ScoreBreakdown = { total: 0, sync: 0, route: 0, position: 0, period: 0, motion: 0, distance: 0, tangent: 0, curvature: 0 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const wrap360 = (value: number) => ((value % 360) + 360) % 360;
const wrap180 = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
const axisDiff = (a: number, b: number) => { const d = Math.abs(wrap180(a - b)); return Math.min(d, Math.abs(180 - d)); };
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

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
  return { center: { x: cx, y: cy }, rotationDeg: theta * 180 / Math.PI, ux, uy, vx, vy, proj, minU, maxU, minV, maxV, majorSpan: maxU - minU, minorSpan: maxV - minV };
}

function currentHeading(sample: RawNavigationSample) { return wrap360(Math.atan2(sample.velocityEast, sample.velocityNorth) * 180 / Math.PI); }

function straightBandCount(samples: RawNavigationSample[], fit: ReturnType<typeof pca>) {
  const bands: number[] = []; const step = Math.max(1, Math.floor(samples.length / 180));
  for (let i = 0; i < samples.length; i += step) {
    const sample = samples[i]; const speed = Math.hypot(sample.velocityEast, sample.velocityNorth); if (speed < .5) continue;
    const headingAxis = Math.atan2(sample.velocityNorth, sample.velocityEast) * 180 / Math.PI;
    if (axisDiff(headingAxis, fit.rotationDeg) > 28) continue;
    bands.push(fit.proj[i]?.v ?? 0);
  }
  if (bands.length < 8) return 2;
  bands.sort((a, b) => a - b); const tolerance = Math.max(6, fit.minorSpan * .18); let clusters = 1;
  for (let i = 1; i < bands.length; i++) if (bands[i] - bands[i - 1] > tolerance) clusters += 1;
  return clusters;
}

function estimateKind(samples: RawNavigationSample[], fit: ReturnType<typeof pca>): RouteKind {
  const aspect = fit.majorSpan / Math.max(1, fit.minorSpan);
  if (aspect < 1.32) return "circle";
  return straightBandCount(samples, fit) >= 3 ? "double" : "single";
}

function meanSpeed(samples: RawNavigationSample[]) { return median(samples.map((s) => Math.hypot(s.velocityEast, s.velocityNorth)).filter((v) => Number.isFinite(v) && v > .1)); }
function routeLength(kind: RouteKind, fit: ReturnType<typeof pca>) {
  if (kind === "circle") return 2 * Math.PI * Math.max(1, (fit.majorSpan + fit.minorSpan) / 4);
  const radius = Math.max(1, fit.minorSpan / 2); const leg = Math.max(1, fit.majorSpan - 2 * radius);
  return kind === "double" ? 2 * (2 * leg + 2 * Math.PI * radius) : 2 * leg + 2 * Math.PI * radius;
}
function routePeriod(kind: RouteKind, fit: ReturnType<typeof pca>, samples: RawNavigationSample[]) { const speed = meanSpeed(samples); return speed > .15 ? routeLength(kind, fit) / speed : null; }

function phaseAndDirection(kind: RouteKind, fit: ReturnType<typeof pca>, sample: RawNavigationSample) {
  const dx = sample.x - fit.center.x, dy = sample.y - fit.center.y;
  if (kind === "circle") {
    const angle = Math.atan2(dy, dx); const tangentEast = -Math.sin(angle), tangentNorth = Math.cos(angle); const dot = sample.velocityEast * tangentEast + sample.velocityNorth * tangentNorth; const direction: 1 | -1 = dot >= 0 ? 1 : -1;
    const raw = wrap360(angle * 180 / Math.PI) / 360; return { phase: direction === 1 ? raw : (1 - raw) % 1, direction };
  }
  const u = dx * fit.ux + dy * fit.uy; const v = dx * fit.vx + dy * fit.vy; const uNorm = clamp((u - fit.minU) / Math.max(1e-6, fit.maxU - fit.minU), 0, 1);
  const along = sample.velocityEast * fit.ux + sample.velocityNorth * fit.uy; const side = v >= 0 ? 1 : -1; const direction: 1 | -1 = side > 0 ? (along >= 0 ? 1 : -1) : (along <= 0 ? 1 : -1);
  let phase = side > 0 ? uNorm * .5 : .5 + (1 - uNorm) * .5; if (direction === -1) phase = (1 - phase) % 1; if (kind === "double") phase = (phase * 2) % 1;
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

type Track = {
  id: number; samples: RawNavigationSample[]; current: RawNavigationSample; fit: ReturnType<typeof pca>; kind: RouteKind; phase: number; direction: 1 | -1;
  periodSec: number | null; routeScore: number; routeDeviation: number; routeDeviationPct: number; tangentErrorDeg: number;
  routeParts: { distance: number; tangent: number; curvature: number }; geometry?: SoGeometryDescriptor;
};

function buildTrack(id: number, samples: RawNavigationSample[], config: CoreConfig): Track | null {
  if (samples.length < 4) return null;
  const current = samples.at(-1)!; const fit = pca(samples.map((sample) => ({ x: sample.x, y: sample.y }))); const kind = estimateKind(samples, fit); const pd = phaseAndDirection(kind, fit, current);
  const nearest = nearestDistanceAndHeading(samples, current); const tangentErrorDeg = Math.abs(wrap180(currentHeading(current) - nearest.heading));
  const radius = Math.max(5, kind === "circle" ? (fit.majorSpan + fit.minorSpan) / 4 : fit.minorSpan / 2); const routeDeviationPct = nearest.distance / radius * 100;
  const curvatureErrorPct = kind === "circle" ? Math.abs(fit.majorSpan - fit.minorSpan) / Math.max(1, (fit.majorSpan + fit.minorSpan) / 2) * 100 : 0;
  const route = routeScoreBreakdown(routeDeviationPct, tangentErrorDeg, curvatureErrorPct, config.thresholds, config.weights); const legLength = Math.max(1, fit.majorSpan - 2 * radius);
  const geometry = kind === "circle" ? undefined : { kind, center: fit.center, radius, legLength, rotationDeg: fit.rotationDeg, ...(kind === "double" ? { secondLegLength: legLength, bendDeg: 28 } : {}) } satisfies SoGeometryDescriptor;
  return { id, samples, current, fit, kind, phase: pd.phase, direction: pd.direction, periodSec: routePeriod(kind, fit, samples), routeScore: route.route, routeDeviation: nearest.distance, routeDeviationPct, tangentErrorDeg, routeParts: { distance: route.distance, tangent: route.tangent, curvature: route.curvature }, geometry };
}

function classifyPhase(diff: number): SoRelation { const d = ((diff % 1) + 1) % 1; const same = Math.min(d, 1 - d), opposite = Math.abs(d - .5); return same <= .125 ? "same" : opposite <= .125 ? "opposite" : "mixed"; }
function templateRelations(config: CoreConfig) { const template = config.soTemplate; if (template?.soSpec?.relations?.length) return template.soSpec.relations; return (template?.values ?? []).map((v) => v === 0 ? "same" : v === 2 ? "opposite" : "mixed"); }

function displayTransform(tracks: Track[]) {
  const points = tracks.flatMap((track) => track.samples.map((s) => ({ x: s.x, y: s.y }))); if (!points.length) return (_p: { x: number; y: number }) => ({ x: 500, y: 285 });
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x)), minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const spanX = Math.max(80, maxX - minX), spanY = Math.max(60, maxY - minY), scale = Math.min(820 / spanX, 450 / spanY); const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return (p: { x: number; y: number }) => ({ x: 500 + (p.x - cx) * scale, y: 285 - (p.y - cy) * scale });
}
function downsamplePath(samples: RawNavigationSample[], transform: ReturnType<typeof displayTransform>) { const step = Math.max(1, Math.floor(samples.length / 100)); return samples.filter((_, index) => index % step === 0).map((s) => transform(s)); }

function periodStats(tracks: Track[]) {
  const periods = tracks.map((track) => track.periodSec).filter((value): value is number => value != null && Number.isFinite(value)); const avg = mean(periods); const speeds = tracks.map((track) => meanSpeed(track.samples)); const avgSpeed = mean(speeds);
  return { periodErrorPct: avg > 0 ? mean(periods.map((value) => Math.abs(value - avg) / avg * 100)) : 0, motionErrorPct: avgSpeed > 0 ? mean(speeds.map((value) => Math.abs(value - avgSpeed) / avgSpeed * 100)) : 0, meanPeriod: avg };
}
function siObservedAngles(tracks: Track[]) {
  if (tracks.length < 2) return []; const center = { x: mean(tracks.map((t) => t.fit.center.x)), y: mean(tracks.map((t) => t.fit.center.y)) }; const ordered = [...tracks].sort((a, b) => a.id - b.id);
  return ordered.slice(0, -1).map((track, index) => { const next = ordered[index + 1]; const a = Math.atan2(track.current.y - center.y, track.current.x - center.x) * 180 / Math.PI; const b = Math.atan2(next.current.y - center.y, next.current.x - center.x) * 180 / Math.PI; return Math.abs(wrap180(b - a)); });
}
function aggregateRouteParts(tracks: Track[]) { return { distance: mean(tracks.map((t) => t.routeParts.distance)), tangent: mean(tracks.map((t) => t.routeParts.tangent)), curvature: mean(tracks.map((t) => t.routeParts.curvature)) }; }

function windEstimate(track: Track, provenance: NavigationProvenance) {
  const speed = meanSpeed(track.samples); let expectedEast = 0, expectedNorth = 0;
  if (track.kind === "circle") {
    const dx = track.current.x - track.fit.center.x, dy = track.current.y - track.fit.center.y, length = Math.max(1e-6, Math.hypot(dx, dy)); const rx = dx / length, ry = dy / length;
    expectedEast = -ry * speed * track.direction; expectedNorth = rx * speed * track.direction;
  } else {
    const alongSign = Math.sign(track.current.velocityEast * track.fit.ux + track.current.velocityNorth * track.fit.uy) || 1; expectedEast = track.fit.ux * speed * alongSign; expectedNorth = track.fit.uy * speed * alongSign;
  }
  const residualEast = track.current.velocityEast - expectedEast, residualNorth = track.current.velocityNorth - expectedNorth; const mps = Math.hypot(residualEast, residualNorth);
  const dataFactor = provenance.completenessPct == null ? Math.min(100, track.samples.length / 12 * 100) : provenance.completenessPct;
  const confidencePct = clamp(track.routeScore * .72 + dataFactor * .28, 0, 99);
  return { speedKnots: mps * 1.9438444924406, bearingDeg: mps < .05 ? 0 : wrap360(Math.atan2(residualEast, residualNorth) * 180 / Math.PI), confidencePct, residualNorth, residualEast };
}

function groupVehicleScores(tracks: Track[], groupScore: ScoreBreakdown, timing: ReturnType<typeof periodStats>, provenance: NavigationProvenance, config: CoreConfig) {
  const out: Record<number, DerivedVehicleEvidence> = {}; const avgSpeed = mean(tracks.map((t) => meanSpeed(t.samples)));
  for (const track of tracks) {
    const periodErrorPct = track.periodSec && timing.meanPeriod ? Math.abs(track.periodSec - timing.meanPeriod) / timing.meanPeriod * 100 : 0; const speed = meanSpeed(track.samples); const motionErrorPct = avgSpeed > 0 ? Math.abs(speed - avgSpeed) / avgSpeed * 100 : 0;
    const period = transferScore(periodErrorPct, config.thresholds.periodFullPct, config.thresholds.periodZeroPct), motion = transferScore(motionErrorPct, config.thresholds.motionFullPct, config.thresholds.motionZeroPct);
    const sync = weighted([groupScore.position, period, motion], [config.weights.sync.position, config.weights.sync.period, config.weights.sync.motion]); const total = weighted([sync, track.routeScore], [config.weights.total.sync, config.weights.total.route]);
    out[track.id] = { id: track.id, kind: track.kind, routeScore: Math.round(track.routeScore), sync: Math.round(sync), total: Math.round(total), routeDeviation: track.routeDeviation, routeDeviationPct: track.routeDeviationPct, tangentErrorDeg: track.tangentErrorDeg, periodSec: track.periodSec, periodErrorPct, motionErrorPct, phase: track.phase, direction: track.direction, wind: windEstimate(track, provenance) };
  }
  return out;
}

function emptyGroup(key: "si" | "so"): DerivedGroup { return { key, id: key === "si" ? "SI-NODATA" : "SO-NODATA", name: key === "si" ? "SI" : "SO", family: key === "si" ? "SI" : "SO", members: [], score: EMPTY_SCORE, routeScore: 0, observedAngles: [], observedRelations: [], periodErrorPct: 0, motionErrorPct: 0, vehicles: {} }; }

function alertsFromAnalysis(groups: { si: DerivedGroup; so: DerivedGroup }, ungrouped: number[], provenance: NavigationProvenance, config: CoreConfig) {
  const alerts: DerivedAlert[] = [];
  if (!provenance.sampleCount) return [{ id: "no-data", severity: "critical", title: "אין נתוני ניווט", detail: "לא התקבלו דגימות בטווח המבוקש ולכן לא חושבו ציונים, קבוצות או שערוך רוח.", vehicleIds: [], evidence: provenance.warnings }];
  if (provenance.completenessPct != null && provenance.completenessPct < 80) alerts.push({ id: "data-gaps", severity: "warning", title: "שלמות נתונים נמוכה", detail: `שלמות הדגימות המחושבת היא ${provenance.completenessPct.toFixed(1)}%. יש לפרש ציונים ואירועים בזהירות.`, vehicleIds: [], evidence: [`${provenance.sampleCount} דגימות`, `מרווח חציוני ${provenance.samplingMedianSeconds?.toFixed(1) ?? "—"} שנ׳`] });
  if (ungrouped.length) alerts.push({ id: "ungrouped", severity: "warning", title: "רכבים מחוץ לקבוצת SO", detail: `הרכבים ${ungrouped.join(", ")} אינם מקיימים את חוקיות הקיבוץ ולכן אינם משתתפים בציון הקבוצה.`, vehicleIds: ungrouped, evidence: [] });
  for (const key of ["si", "so"] as const) {
    const group = groups[key]; if (!group.members.length) continue;
    if (group.periodErrorPct > config.thresholds.periodFullPct) alerts.push({ id: `${key}-period`, severity: group.periodErrorPct >= config.thresholds.periodZeroPct ? "critical" : "warning", title: `שינוי זמן מחזור בקבוצת ${key.toUpperCase()}`, detail: `פער זמן המחזור שנגזר מהניווט הוא ${group.periodErrorPct.toFixed(1)}%. סף מלא ${config.thresholds.periodFullPct}% וסף אפס ${config.thresholds.periodZeroPct}%.`, vehicleIds: group.members, evidence: [`Sync ${group.score.sync}`, `רכיב מחזור ${group.score.period}`] });
    const worst = Object.values(group.vehicles).sort((a, b) => b.routeDeviationPct - a.routeDeviationPct)[0];
    if (worst && worst.routeDeviationPct > config.thresholds.routeDistanceFullPct) alerts.push({ id: `${key}-route-${worst.id}`, severity: worst.routeDeviationPct >= config.thresholds.routeDistanceZeroPct ? "critical" : "warning", title: `סטיית נתיב ברכב ${worst.id}`, detail: `הסטייה הנוכחית היא ${worst.routeDeviation.toFixed(1)} מ׳ (${worst.routeDeviationPct.toFixed(1)}% מרדיוס הייחוס), מול סף מלא ${config.thresholds.routeDistanceFullPct}% וסף אפס ${config.thresholds.routeDistanceZeroPct}%.`, vehicleIds: [worst.id], evidence: [`שגיאת משיק ${worst.tangentErrorDeg.toFixed(1)}°`, `ציון נתיב ${worst.routeScore}`] });
  }
  if (!alerts.length) alerts.push({ id: "stable", severity: "info", title: "אין חריגה מאושרת כרגע", detail: "הציונים, זמני המחזור והסטיות המחושבים מנתוני הניווט נמצאים בתחום התקין של הספים המוגדרים.", vehicleIds: [], evidence: [] });
  return alerts;
}

export function analyzeNavigationDataset(dataset: NavigationDataset, config: CoreConfig): CoreAnalysis {
  const groupingSettings = config.groupingSettings ?? DEFAULT_SO_GROUPING; const byVehicle = groupByVehicle(dataset.samples); const tracks = [...byVehicle.entries()].map(([id, samples]) => buildTrack(id, samples, config)).filter((track): track is Track => Boolean(track));
  if (!tracks.length) { const groups = { si: emptyGroup("si"), so: emptyGroup("so") }; return { coreApiVersion: CORE_API_VERSION, available: false, provenance: dataset.provenance, routes: [], groups, ungroupedVehicles: [], current: {}, alerts: alertsFromAnalysis(groups, [], dataset.provenance, config), groupingNotes: [] }; }
  const transform = displayTransform(tracks); const circles = tracks.filter((track) => track.kind === "circle"); const soTracks = tracks.filter((track) => track.kind !== "circle" && track.geometry);
  const centerCompatible = circles.filter((track) => circles.every((other) => track === other || distance(track.fit.center, other.fit.center) <= Math.max(track.fit.minorSpan, other.fit.minorSpan) * .7)); const siTracks = centerCompatible.length >= 2 ? centerCompatible : [];
  const soCandidates = soTracks.map((track) => ({ track, geometry: track.geometry! })); const groupedSo = largestCompatibleComponent(soCandidates, groupingSettings); const groupedSoIds = new Set(groupedSo.grouped.map((item) => item.track.id)); const activeSo = groupedSo.grouped.length >= 2 ? soTracks.filter((track) => groupedSoIds.has(track.id)) : [];
  const ungrouped = soTracks.filter((track) => !activeSo.some((grouped) => grouped.id === track.id)).map((track) => track.id); const groupingNotes = [...groupedSo.pairEvidence.entries()].map(([key, evidence]) => `${key}: ${evidence.explanation}`);
  const siTiming = periodStats(siTracks), soTiming = periodStats(activeSo); const siAngles = siObservedAngles(siTracks); const orderedSo = [...activeSo].sort((a, b) => a.fit.center.x - b.fit.center.x || a.id - b.id); const soRelations = orderedSo.slice(0, -1).map((track, index) => classifyPhase(orderedSo[index + 1].phase - track.phase));
  const siRouteScore = mean(siTracks.map((track) => track.routeScore)), soRouteScore = mean(activeSo.map((track) => track.routeScore)); const siRouteParts = aggregateRouteParts(siTracks), soRouteParts = aggregateRouteParts(activeSo);
  const siScore = siTracks.length >= 2 ? siScores(siAngles, config.siTemplate?.values ?? [], config.thresholds, config.weights, siRouteScore, siRouteParts, siTiming.periodErrorPct, siTiming.motionErrorPct) : EMPTY_SCORE;
  const soScore = activeSo.length >= 2 ? soScores(soRelations, templateRelations(config), config.thresholds, config.weights, soRouteScore, soRouteParts, soTiming.periodErrorPct, soTiming.motionErrorPct) : EMPTY_SCORE;
  const groups: { si: DerivedGroup; so: DerivedGroup } = {
    si: { key: "si", id: "SI-NAV", name: "קבוצת SI", family: "SI", members: siTracks.map((t) => t.id), score: siScore, routeScore: siRouteScore, observedAngles: siAngles, observedRelations: [], periodErrorPct: siTiming.periodErrorPct, motionErrorPct: siTiming.motionErrorPct, vehicles: groupVehicleScores(siTracks, siScore, siTiming, dataset.provenance, config) },
    so: { key: "so", id: "SO-NAV", name: "קבוצת SO", family: "SO", members: activeSo.map((t) => t.id), score: soScore, routeScore: soRouteScore, observedAngles: [], observedRelations: soRelations, periodErrorPct: soTiming.periodErrorPct, motionErrorPct: soTiming.motionErrorPct, vehicles: groupVehicleScores(activeSo, soScore, soTiming, dataset.provenance, config) },
  };
  const routes: DerivedRoute[] = tracks.map((track) => ({ key: `nav-${track.id}`, vehicleId: track.id, kind: track.kind, points: downsamplePath(track.samples, transform), geometry: track.geometry, centerMetric: track.fit.center, rotationDeg: track.fit.rotationDeg, radius: Math.max(5, track.kind === "circle" ? (track.fit.majorSpan + track.fit.minorSpan) / 4 : track.fit.minorSpan / 2), legLength: Math.max(1, track.fit.majorSpan - track.fit.minorSpan), periodSec: track.periodSec }));
  const current = Object.fromEntries(tracks.map((track) => { const p = transform(track.current); return [track.id, { x: p.x, y: p.y, headingDeg: currentHeading(track.current), latitude: track.current.latitude, longitude: track.current.longitude, timestamp: track.current.timestamp }]; }));
  return { coreApiVersion: CORE_API_VERSION, available: true, provenance: dataset.provenance, routes, groups, ungroupedVehicles: ungrouped, current, alerts: alertsFromAnalysis(groups, ungrouped, dataset.provenance, config), groupingNotes };
}

export function compareMembership(a: CoreAnalysis, b: CoreAnalysis) {
  const change = (key: "si" | "so") => { const before = new Set(a.groups[key].members), after = new Set(b.groups[key].members); return { joined: [...after].filter((id) => !before.has(id)), left: [...before].filter((id) => !after.has(id)) }; };
  return { si: change("si"), so: change("so") };
}
