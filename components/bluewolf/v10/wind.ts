export type WindMode = "off" | "steady" | "gusty" | "crosswind";

export type WindEstimate = {
  trueKnots: number;
  trueBearingDeg: number;
  estimatedKnots: number;
  estimatedBearingDeg: number;
  confidence: number;
  syncPenalty: number;
};

const wrap360 = (value: number) => ((value % 360) + 360) % 360;
const round1 = (value: number) => Math.round(value * 10) / 10;

export function windForVehicle(serverId: string, tick: number, vehicleId: number, mode: WindMode): WindEstimate {
  if (mode === "off") return { trueKnots: 0, trueBearingDeg: 0, estimatedKnots: 0, estimatedBearingDeg: 0, confidence: 99, syncPenalty: 0 };
  const seed = Number(serverId) * 37 + vehicleId * 0.17;
  const base = mode === "steady" ? 8 : mode === "crosswind" ? 13 : 10;
  const gust = mode === "gusty" ? 4.5 * Math.sin(tick / 17 + seed) + 2.1 * Math.sin(tick / 5.3 + seed * .4) : 1.2 * Math.sin(tick / 31 + seed);
  const trueKnots = Math.max(0, base + gust + (vehicleId % 5) * .35);
  const nominalBearing = mode === "crosswind" ? 270 : 210 + Number(serverId) * 17;
  const trueBearingDeg = wrap360(nominalBearing + 14 * Math.sin(tick / 53 + seed * .07));

  // Navigation-only estimator under a locally constant nominal-speed assumption.
  // Small deterministic model/controller residuals intentionally keep the estimate imperfect.
  const magnitudeError = .45 * Math.sin(tick / 11 + vehicleId * .13);
  const bearingError = 3.8 * Math.sin(tick / 19 + vehicleId * .09);
  const estimatedKnots = Math.max(0, trueKnots + magnitudeError);
  const estimatedBearingDeg = wrap360(trueBearingDeg + bearingError);
  const confidence = Math.round(Math.max(55, Math.min(98, 94 - Math.abs(gust) * 2.2 - Math.abs(magnitudeError) * 4)));
  const syncPenalty = Math.max(0, Math.min(18, trueKnots * .42 + Math.abs(gust) * .55));

  return {
    trueKnots: round1(trueKnots),
    trueBearingDeg: round1(trueBearingDeg),
    estimatedKnots: round1(estimatedKnots),
    estimatedBearingDeg: round1(estimatedBearingDeg),
    confidence,
    syncPenalty: round1(syncPenalty),
  };
}

export function averageWindPenalty(serverId: string, tick: number, vehicleIds: number[], mode: WindMode) {
  if (!vehicleIds.length || mode === "off") return 0;
  return vehicleIds.reduce((sum, id) => sum + windForVehicle(serverId, tick, id, mode).syncPenalty, 0) / vehicleIds.length;
}
