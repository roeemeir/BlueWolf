import type { ScoreThresholds, ScoreWeights, SoRelation } from "@/lib/bluewolf";

export type ScoreTriple = { total: number; sync: number; route: number; position: number; period: number; motion: number };

export function transferScore(error: number, full: number, zero: number) {
  const safeError = Math.max(0, error);
  if (safeError <= full) return 100;
  if (safeError >= zero) return 0;
  return 100 * (zero - safeError) / Math.max(1e-9, zero - full);
}

function weighted(values: number[], weights: number[]) {
  const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!total) return 0;
  return values.reduce((sum, value, index) => sum + value * Math.max(0, weights[index] ?? 0), 0) / total;
}

export function siTemplateScores(
  observedAngles: number[],
  templateAngles: number[],
  thresholds: ScoreThresholds,
  weights: ScoreWeights,
  routeScore: number,
  periodErrorPct = 2,
  motionErrorPct = 4,
): ScoreTriple {
  const count = Math.max(observedAngles.length, templateAngles.length, 1);
  const perPair = Array.from({ length: count }, (_, index) => {
    const observed = observedAngles[index] ?? observedAngles.at(-1) ?? 120;
    const desired = templateAngles[index] ?? templateAngles.at(-1) ?? 120;
    const raw = Math.abs(observed - desired) % 360;
    const error = Math.min(raw, 360 - raw);
    return transferScore(error, thresholds.siPositionFullDeg, thresholds.siPositionZeroDeg);
  });
  const position = perPair.reduce((sum, value) => sum + value, 0) / perPair.length;
  const period = transferScore(periodErrorPct, thresholds.periodFullPct, thresholds.periodZeroPct);
  const motion = transferScore(motionErrorPct, thresholds.motionFullPct, thresholds.motionZeroPct);
  const sync = weighted([position, period, motion], [weights.sync.position, weights.sync.period, weights.sync.motion]);
  const total = weighted([sync, routeScore], [weights.total.sync, weights.total.route]);
  return { total: Math.round(total), sync: Math.round(sync), route: Math.round(routeScore), position: Math.round(position), period: Math.round(period), motion: Math.round(motion) };
}

function relationPhaseError(observed: SoRelation, desired: SoRelation) {
  if (observed === desired) return 0;
  if (observed === "mixed" || desired === "mixed") return 0.25;
  return 0.5;
}

export function soTemplateScores(
  observedRelations: SoRelation[],
  templateRelations: SoRelation[],
  thresholds: ScoreThresholds,
  weights: ScoreWeights,
  routeScore: number,
  periodErrorPct = 3,
  motionErrorPct = 6,
): ScoreTriple {
  const count = Math.max(observedRelations.length, templateRelations.length, 1);
  const perPair = Array.from({ length: count }, (_, index) => {
    const observed = observedRelations[index] ?? observedRelations.at(-1) ?? "same";
    const desired = templateRelations[index] ?? templateRelations.at(-1) ?? "same";
    const errorPct = relationPhaseError(observed, desired) * 100;
    return transferScore(errorPct, thresholds.soPositionFullPct, thresholds.soPositionZeroPct);
  });
  const position = perPair.reduce((sum, value) => sum + value, 0) / perPair.length;
  const period = transferScore(periodErrorPct, thresholds.periodFullPct, thresholds.periodZeroPct);
  const motion = transferScore(motionErrorPct, thresholds.motionFullPct, thresholds.motionZeroPct);
  const sync = weighted([position, period, motion], [weights.sync.position, weights.sync.period, weights.sync.motion]);
  const total = weighted([sync, routeScore], [weights.total.sync, weights.total.route]);
  return { total: Math.round(total), sync: Math.round(sync), route: Math.round(routeScore), position: Math.round(position), period: Math.round(period), motion: Math.round(motion) };
}

export function sensitivityEvidence(thresholds: ScoreThresholds, weights: ScoreWeights) {
  const perfect = siTemplateScores([120, 120], [120, 120], thresholds, weights, 90);
  const moderate = siTemplateScores([120, 120], [105, 105], thresholds, weights, 90);
  const wrong = siTemplateScores([120, 120], [90, 90], thresholds, weights, 90);
  return { perfect, moderate, wrong, pass: perfect.sync > moderate.sync && moderate.sync > wrong.sync && perfect.sync - wrong.sync >= 45 };
}
