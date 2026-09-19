import { telAvivDemoBounds } from "./default-map-profile";

export type OperationalProjectionMode = "local-wgs84" | "webmercator";
export type GeoPoint = { latitude: number; longitude: number };
export type ScreenPoint = { x: number; y: number };
export type WorldPoint = { x: number; y: number };
export type WorldBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type GeoBounds = { minLatitude: number; minLongitude: number; maxLatitude: number; maxLongitude: number };

const MAX_MERCATOR_LATITUDE = 85.05112878;
const EPS = 1e-12;

function clampLatitude(latitude: number) {
  return Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
}

export function geoToWebMercatorWorld(latitude: number, longitude: number): WorldPoint {
  const lat = clampLatitude(latitude) * Math.PI / 180;
  return {
    x: (longitude + 180) / 360,
    y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2,
  };
}

export function webMercatorWorldToGeo(point: WorldPoint): GeoPoint {
  const longitude = point.x * 360 - 180;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y))) * 180 / Math.PI;
  return { latitude, longitude };
}

export type OperationalProjection = {
  mode: OperationalProjectionMode;
  empty: boolean;
  project: (latitude: number, longitude: number) => ScreenPoint;
  worldToScreen: (point: WorldPoint) => ScreenPoint;
  viewWorldBounds: WorldBounds | null;
  viewGeoBounds: GeoBounds | null;
};

export function createOperationalProjection(
  rows: readonly GeoPoint[],
  width: number,
  height: number,
  marginX: number,
  marginY: number,
  mode: OperationalProjectionMode,
): OperationalProjection {
  if (!rows.length) {
    const bounds = telAvivDemoBounds();
    const fallbackRows = [
      { latitude: bounds.minLatitude, longitude: bounds.minLongitude },
      { latitude: bounds.minLatitude, longitude: bounds.maxLongitude },
      { latitude: bounds.maxLatitude, longitude: bounds.minLongitude },
      { latitude: bounds.maxLatitude, longitude: bounds.maxLongitude },
    ];
    // The operational map still reports "no WGS84 evidence" in its overlay;
    // only the basemap viewport gets a deterministic Tel Aviv QA frame.
    return createOperationalProjection(fallbackRows, width, height, marginX, marginY, mode);
  }
  const midLatitude = rows.reduce((sum, row) => sum + row.latitude, 0) / rows.length;
  const longitudeScale = Math.max(0.15, Math.cos(midLatitude * Math.PI / 180));
  const toWorld = mode === "webmercator"
    ? (row: GeoPoint) => geoToWebMercatorWorld(row.latitude, row.longitude)
    : (row: GeoPoint): WorldPoint => ({ x: row.longitude * longitudeScale, y: -row.latitude });
  const fromWorld = mode === "webmercator"
    ? webMercatorWorldToGeo
    : (point: WorldPoint): GeoPoint => ({ latitude: -point.y, longitude: point.x / longitudeScale });
  const world = rows.map(toWorld);
  const minX = Math.min(...world.map((row) => row.x)); const maxX = Math.max(...world.map((row) => row.x));
  const minY = Math.min(...world.map((row) => row.y)); const maxY = Math.max(...world.map((row) => row.y));
  const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
  const rawSpanX = Math.max(maxX - minX, EPS); const rawSpanY = Math.max(maxY - minY, EPS);
  const spanX = Math.max(rawSpanX * 1.24, rawSpanY * 0.35, 1e-8);
  const spanY = Math.max(rawSpanY * 1.24, rawSpanX * 0.35, 1e-8);
  const scale = Math.min((width - 2 * marginX) / spanX, (height - 2 * marginY) / spanY);
  const worldToScreen = (point: WorldPoint): ScreenPoint => ({ x: width / 2 + (point.x - centerX) * scale, y: height / 2 + (point.y - centerY) * scale });
  const project = (latitude: number, longitude: number) => worldToScreen(toWorld({ latitude, longitude }));
  const viewWorldBounds = {
    minX: centerX - width / (2 * scale),
    maxX: centerX + width / (2 * scale),
    minY: centerY - height / (2 * scale),
    maxY: centerY + height / (2 * scale),
  };
  const northWest = fromWorld({ x: viewWorldBounds.minX, y: viewWorldBounds.minY });
  const southEast = fromWorld({ x: viewWorldBounds.maxX, y: viewWorldBounds.maxY });
  const viewGeoBounds = {
    minLatitude: Math.min(northWest.latitude, southEast.latitude),
    maxLatitude: Math.max(northWest.latitude, southEast.latitude),
    minLongitude: Math.min(northWest.longitude, southEast.longitude),
    maxLongitude: Math.max(northWest.longitude, southEast.longitude),
  };
  return { mode, empty: false, project, worldToScreen, viewWorldBounds, viewGeoBounds };
}

export type WebMercatorTile = { z: number; x: number; y: number; screenX: number; screenY: number; width: number; height: number };

export function webMercatorTiles(projection: OperationalProjection, viewportWidth: number, viewportHeight: number, maxTiles = 64): WebMercatorTile[] {
  if (projection.mode !== "webmercator" || !projection.viewWorldBounds) return [];
  const bounds = projection.viewWorldBounds;
  const spanX = Math.max(bounds.maxX - bounds.minX, EPS);
  const spanY = Math.max(bounds.maxY - bounds.minY, EPS);
  let zoom = Math.max(0, Math.min(22, Math.floor(Math.min(
    Math.log2(viewportWidth / (256 * spanX)),
    Math.log2(viewportHeight / (256 * spanY)),
  ))));
  const build = (z: number) => {
    const count = 2 ** z;
    const minTileX = Math.max(0, Math.floor(bounds.minX * count));
    const maxTileX = Math.min(count - 1, Math.floor(bounds.maxX * count));
    const minTileY = Math.max(0, Math.floor(bounds.minY * count));
    const maxTileY = Math.min(count - 1, Math.floor(bounds.maxY * count));
    const tiles: WebMercatorTile[] = [];
    for (let y = minTileY; y <= maxTileY; y += 1) for (let x = minTileX; x <= maxTileX; x += 1) {
      const topLeft = projection.worldToScreen({ x: x / count, y: y / count });
      const bottomRight = projection.worldToScreen({ x: (x + 1) / count, y: (y + 1) / count });
      tiles.push({ z, x, y, screenX: topLeft.x, screenY: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y });
    }
    return tiles;
  };
  let tiles = build(zoom);
  while (tiles.length > maxTiles && zoom > 0) { zoom -= 1; tiles = build(zoom); }
  return tiles;
}
