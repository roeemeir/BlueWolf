import { formatRouteWkt, parseRouteWkt, translateRouteWkt } from "./route-wkt";

export type RouteGeoViewport = {
  west: number;
  east: number;
  south: number;
  north: number;
};

export type RouteEditorPoint = { xPct: number; yPct: number };

function validateViewport(viewport: RouteGeoViewport) {
  const values = [viewport.west, viewport.east, viewport.south, viewport.north];
  if (!values.every(Number.isFinite)) throw new Error("גבולות המפה אינם תקינים");
  if (viewport.west >= viewport.east || viewport.south >= viewport.north) throw new Error("גבולות המפה הפוכים או ריקים");
  if (viewport.west < -180 || viewport.east > 180 || viewport.south < -90 || viewport.north > 90) throw new Error("גבולות המפה מחוץ ל-WGS84");
}

export function normalizeRouteGeometry(value: string): string {
  return formatRouteWkt(parseRouteWkt(value));
}

export function routeCentroid(value: string) {
  const { points } = parseRouteWkt(value);
  const unique = points.slice(0, -1);
  return unique.reduce(
    (sum, point) => ({ longitude: sum.longitude + point.longitude / unique.length, latitude: sum.latitude + point.latitude / unique.length }),
    { longitude: 0, latitude: 0 },
  );
}

export function routeEditorPoint(value: string, viewport: RouteGeoViewport): RouteEditorPoint {
  validateViewport(viewport);
  const center = routeCentroid(value);
  return {
    xPct: ((center.longitude - viewport.west) / (viewport.east - viewport.west)) * 100,
    yPct: ((viewport.north - center.latitude) / (viewport.north - viewport.south)) * 100,
  };
}

/**
 * Translate the WGS84 geometry by the exact geographic delta represented by a drag
 * inside a known map viewport. Screen percentages are never persisted as geometry.
 */
export function translateRouteByEditorDrag(
  value: string,
  previous: RouteEditorPoint,
  next: RouteEditorPoint,
  viewport: RouteGeoViewport,
): string {
  validateViewport(viewport);
  const values = [previous.xPct, previous.yPct, next.xPct, next.yPct];
  if (!values.every(Number.isFinite)) throw new Error("נקודת גרירה אינה תקינה");
  const longitudeDelta = ((next.xPct - previous.xPct) / 100) * (viewport.east - viewport.west);
  const latitudeDelta = -((next.yPct - previous.yPct) / 100) * (viewport.north - viewport.south);
  return normalizeRouteGeometry(translateRouteWkt(value, longitudeDelta, latitudeDelta));
}
