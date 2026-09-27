export const METERS_PER_NAUTICAL_MILE = 1852;
export const SECONDS_PER_HOUR = 3600;
export const KILOMETERS_PER_NAUTICAL_MILE = 1.852;

export function metersPerSecondToKnots(speedMps: number) {
  if (!Number.isFinite(speedMps) || speedMps < 0) throw new Error("speedMps must be a finite non-negative number");
  return speedMps * SECONDS_PER_HOUR / METERS_PER_NAUTICAL_MILE;
}

export function kilometersPerHourToKnots(speedKmh: number) {
  if (!Number.isFinite(speedKmh) || speedKmh < 0) throw new Error("speedKmh must be a finite non-negative number");
  return speedKmh / KILOMETERS_PER_NAUTICAL_MILE;
}

export function formatKnotsFromMps(speedMps: number, digits = 1) {
  return `${metersPerSecondToKnots(speedMps).toFixed(digits)} קשר`;
}

export function formatKnotsFromKmh(speedKmh: number, digits = 1) {
  return `${kilometersPerHourToKnots(speedKmh).toFixed(digits)} קשר`;
}
