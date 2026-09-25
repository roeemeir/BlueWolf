import type { SoPoint } from "./so-geometry";

/** Synthetic operator-map navigation only: never label these fixes as Python Core telemetry. */
export type SyntheticNavigationFix = SoPoint & {
  heading: number;
  tick: number;
  source: "synthetic-sim-navigation";
};

export type SyntheticNavigationInput = {
  serverId: string;
  vehicleId: number;
  tick: number;
  ideal: SoPoint & { heading: number };
};

/**
 * Deterministic test/visualization signal with two components:
 * low-frequency correlated drift (a changing wind effect) and vehicle-specific
 * higher-frequency GPS jitter. An occasional explicit null models a missing
 * observed fix, so rendering must not extrapolate through it. The SVG map uses
 * schematic units, NOT measured metres or WGS84; this synthetic signal must
 * never be reused as Core or investigation-archive evidence.
 */
export function simulationObservedFix(input: SyntheticNavigationInput): SyntheticNavigationFix | null {
  const { serverId, vehicleId, tick, ideal } = input;
  const server = Number(serverId);
  if (![1, 2, 3].includes(server) || !Number.isInteger(vehicleId) || !Number.isInteger(tick) || tick < 0
    || !Number.isFinite(ideal.x) || !Number.isFinite(ideal.y) || !Number.isFinite(ideal.heading)) return null;

  // A six-tick (30-second at 12 ticks/minute) gap per scheduled outage, with
  // vehicle/server-dependent phase. Returning null drops the vehicle marker
  // and makes the next visible trace frame start a fresh segment.
  const outageIndex = Math.floor(tick / 6) + 13 * vehicleId + 17 * server;
  if (outageIndex % 173 === 0) return null;

  const windPhase = tick * 0.011 + server * 1.31;
  const windX = (2.3 + server * 0.55) * Math.sin(windPhase);
  const windY = (1.8 + server * 0.45) * Math.cos(windPhase * 0.79);
  const vehiclePhase = tick * (0.34 + (Math.abs(vehicleId) % 7) * 0.035) + vehicleId * 0.67 + server * 2.1;
  const jitterX = 1.25 * Math.sin(vehiclePhase) + 0.4 * Math.sin(vehiclePhase * 2.31);
  const jitterY = 1.1 * Math.cos(vehiclePhase * 1.13) + 0.35 * Math.cos(vehiclePhase * 2.07);
  const lateralOffset = Math.sin(tick * 0.023 + vehicleId * 0.31 + server) * 1.4;

  return {
    x: ideal.x + windX + jitterX + lateralOffset,
    y: ideal.y + windY + jitterY - lateralOffset * 0.28,
    heading: ideal.heading + 1.1 * Math.sin(vehiclePhase * 0.5),
    tick,
    source: "synthetic-sim-navigation",
  };
}
