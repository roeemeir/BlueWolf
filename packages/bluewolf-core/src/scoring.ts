import type { ScoreBreakdown, ScoreThresholds, ScoreWeights, SoRelation } from "./contracts.ts";

const round = (value: number) => Math.round(Math.max(0, Math.min(100, value)));

export function transferScore(error: number, full: number, zero: number) {
  const safeError = Math.max(0, error);
  if (safeError <= full) return 100;
  if (safeError >= zero) return 0;
  return 100 * (zero - safeError) / Math.max(1e-9, zero - full);
}

export function weighted(values: number[], weights: number[]) {
  const safe = weights.map((value) => Math.max(0, value));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  return values.reduce((sum, value, index) => sum + value * (safe[index] ?? 0), 0) / total;
}

function relationPhaseError(observed: SoRelation, desired: SoRelation) {
  if (observed === desired) return 0;
  if (observed === "mixed" || desired === "mixed") return .25;
  return .5;
}

export function routeScoreBreakdown(distanceErrorPct: number, tangentErrorDeg: number, curvatureErrorPct: number, thresholds: ScoreThresholds, weights: ScoreWeights) {
  const distance = transferScore(distanceErrorPct, thresholds.routeDistanceFullPct, thresholds.routeDistanceZeroPct);
  const tangent = transferScore(tangentErrorDeg, thresholds.tangentFullDeg, thresholds.tangentZeroDeg);
  const curvature = transferScore(curvatureErrorPct, thresholds.curvatureFullPct, thresholds.curvatureZeroPct);
  return { distance, tangent, curvature, route: weighted([distance, tangent, curvature], [weights.route.distance, weights.route.tangent, weights.route.curvature]) };
}

export function siScores(observedAngles: number[], desiredAngles: number[], thresholds: ScoreThresholds, weights: ScoreWeights, routeScore: number, routeParts: { distance: number; tangent: number; curvature: number }, periodErrorPct: number, motionErrorPct: number): ScoreBreakdown {
  const count = Math.min(observedAngles.length, desiredAngles.length);
  const position = count > 0 ? observedAngles.slice(0, count).reduce((sum, observed, index) => {
    const desired = desiredAngles[index];
    const raw = Math.abs(observed - desired) % 360;
    return sum + transferScore(Math.min(raw, 360 - raw), thresholds.siPositionFullDeg, thresholds.siPositionZeroDeg);
  }, 0) / count : 0;
  const period = transferScore(periodErrorPct, thresholds.periodFullPct, thresholds.periodZeroPct);
  const motion = transferScore(motionErrorPct, thresholds.motionFullPct, thresholds.motionZeroPct);
  const sync = weighted([position, period, motion], [weights.sync.position, weights.sync.period, weights.sync.motion]);
  const total = weighted([sync, routeScore], [weights.total.sync, weights.total.route]);
  return { total: round(total), sync: round(sync), route: round(routeScore), position: round(position), period: round(period), motion: round(motion), distance: round(routeParts.distance), tangent: round(routeParts.tangent), curvature: round(routeParts.curvature) };
}

export function soScores(observedRelations: SoRelation[], desiredRelations: SoRelation[], thresholds: ScoreThresholds, weights: ScoreWeights, routeScore: number, routeParts: { distance: number; tangent: number; curvature: number }, periodErrorPct: number, motionErrorPct: number): ScoreBreakdown {
  const count = Math.min(observedRelations.length, desiredRelations.length);
  const position = count > 0 ? observedRelations.slice(0, count).reduce((sum, observed, index) => sum + transferScore(relationPhaseError(observed, desiredRelations[index]) * 100, thresholds.soPositionFullPct, thresholds.soPositionZeroPct), 0) / count : 0;
  const period = transferScore(periodErrorPct, thresholds.periodFullPct, thresholds.periodZeroPct);
  const motion = transferScore(motionErrorPct, thresholds.motionFullPct, thresholds.motionZeroPct);
  const sync = weighted([position, period, motion], [weights.sync.position, weights.sync.period, weights.sync.motion]);
  const total = weighted([sync, routeScore], [weights.total.sync, weights.total.route]);
  return { total: round(total), sync: round(sync), route: round(routeScore), position: round(position), period: round(period), motion: round(motion), distance: round(routeParts.distance), tangent: round(routeParts.tangent), curvature: round(routeParts.curvature) };
}
