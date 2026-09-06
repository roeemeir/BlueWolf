import { provenanceFromSamples, type NavigationDataset, type RawNavigationSample } from "../src/index.ts";

const ORIGIN = new Date("2026-09-06T12:00:00.000Z");

export function circleDataset({ vehicles = [101, 102, 103], durationSeconds = 360, joinVehicleAtSeconds }: { vehicles?: number[]; durationSeconds?: number; joinVehicleAtSeconds?: Record<number, number> } = {}): NavigationDataset {
  const samples: RawNavigationSample[] = []; const radius = 100; const period = 120; const omega = 2 * Math.PI / period; const dt = 2;
  for (let second = 0; second <= durationSeconds; second += dt) {
    for (let index = 0; index < vehicles.length; index += 1) {
      const vehicleId = vehicles[index]; const joinAt = joinVehicleAtSeconds?.[vehicleId] ?? 0; if (second < joinAt) continue;
      const phase = index * 2 * Math.PI / vehicles.length; const angle = omega * second + phase;
      const x = radius * Math.cos(angle), y = radius * Math.sin(angle);
      const velocityEast = -radius * omega * Math.sin(angle), velocityNorth = radius * omega * Math.cos(angle);
      samples.push({ source: "simulation", serverId: "fixture", timestamp: new Date(ORIGIN.getTime() + second * 1000).toISOString(), vehicleId, active: true, latitude: 31.7 + y / 111_320, longitude: 34.8 + x / 94_000, altitude: 35, velocityNorth, velocityEast, x, y });
    }
  }
  const from = ORIGIN, to = new Date(ORIGIN.getTime() + durationSeconds * 1000);
  return { samples, provenance: provenanceFromSamples("simulation", "fixture", from, to, samples, ["core fixture"])};
}

export const DEFAULT_THRESHOLDS = {
  siPositionFullDeg: 10, siPositionZeroDeg: 30, soPositionFullPct: 5, soPositionZeroPct: 25,
  periodFullPct: 5, periodZeroPct: 20, motionFullPct: 10, motionZeroPct: 30,
  routeDistanceFullPct: 5, routeDistanceZeroPct: 30, tangentFullDeg: 10, tangentZeroDeg: 60,
  curvatureFullPct: 10, curvatureZeroPct: 100, lowSpeedPct: 30, smoothingSeconds: 10, greenScore: 80, redScore: 50,
};
export const DEFAULT_WEIGHTS = { sync: { position: 60, period: 20, motion: 20 }, route: { distance: 15, tangent: 70, curvature: 15 }, total: { sync: 75, route: 25 } };
export const DEFAULT_CONFIG = { thresholds: DEFAULT_THRESHOLDS, weights: DEFAULT_WEIGHTS, siTemplate: { family: "SI" as const, values: [120, 120] }, soTemplate: { family: "SO" as const, values: [2], soSpec: { relations: ["opposite" as const] } }, groupingSettings: { maxParallelLegs: 1.5, maxLateralLegs: .35, maxAngleDeg: 20 } };
