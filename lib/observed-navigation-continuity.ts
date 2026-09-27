/** Display-only continuity rule for measured WGS84 navigation. It never
 * modifies Core validity, period estimation, grouping or synchronization.
 * An implausible hop may retain both observed fixes, but must not be drawn
 * as a made-up straight line in either the operator map or the PDF. */
export type Wgs84Fix = { latitude: number; longitude: number };
export const OBSERVED_NAVIGATION_MAX_DISPLAY_SPEED_MPS = 1_000;
export const OBSERVED_NAVIGATION_MAX_DISPLAY_GAP_MS = 10_000;

export function validObservedWgs84(fix: Wgs84Fix): boolean {
  return Number.isFinite(fix.latitude) && fix.latitude >= -90 && fix.latitude <= 90
    && Number.isFinite(fix.longitude) && fix.longitude >= -180 && fix.longitude <= 180;
}

/** Great-circle distance respects the 180/-180 longitude wrap. */
export function observedGreatCircleDistanceM(first: Wgs84Fix, second: Wgs84Fix): number {
  if (!validObservedWgs84(first) || !validObservedWgs84(second)) return Number.NaN;
  const rad = Math.PI / 180;
  const dLat = (second.latitude - first.latitude) * rad;
  const dLon = (second.longitude - first.longitude) * rad;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(first.latitude * rad) * Math.cos(second.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

/** Both samples remain evidence if the segment fails the display guard. */
export function continuousObservedNavigationSegment(
  first: Wgs84Fix,
  second: Wgs84Fix,
  deltaMs: number,
  maxGapMs = OBSERVED_NAVIGATION_MAX_DISPLAY_GAP_MS,
): boolean {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > maxGapMs || maxGapMs <= 0) return false;
  const displacement = observedGreatCircleDistanceM(first, second);
  return Number.isFinite(displacement)
    && displacement <= OBSERVED_NAVIGATION_MAX_DISPLAY_SPEED_MPS * deltaMs / 1_000;
}
