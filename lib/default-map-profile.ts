import {
  DEFAULT_MAP_TOKEN_PATH_PLACEHOLDER,
  type OperationalMapSource,
} from "./map-source-config";

export const TEL_AVIV_DEMO_CENTER = Object.freeze({ latitude: 32.0853, longitude: 34.7818 });
export const TEL_AVIV_DEMO_HALF_SPAN = Object.freeze({ latitude: 0.035, longitude: 0.055 });

export const DEFAULT_PUBLIC_WMTS_SOURCE_ID = "omniscale-demo";

/**
 * Out-of-box QA/demo basemap. The workspace contains only a path-token
 * placeholder; even the public Omniscale demo key is injected server-side via
 * the same SQLite secret path used by operational/private map servers.
 */
export const DEFAULT_PUBLIC_WMTS_SOURCE: OperationalMapSource = Object.freeze({
  id: DEFAULT_PUBLIC_WMTS_SOURCE_ID,
  name: "Omniscale OSM · תל אביב · WMTS QA",
  kind: "wmts",
  baseUrl: `https://maps.omniscale.net/v2/${DEFAULT_MAP_TOKEN_PATH_PLACEHOLDER}/WMTSCapabilities.xml`,
  attribution: "© Omniscale 2026 – Map data: OpenStreetMap (License ODbL)",
  enabled: true,
  isDefault: true,
  layer: "osm",
  style: "default",
  format: "image/png",
  version: "1.0.0",
  crs: "EPSG:3857",
  tileMatrixSet: "EPSG:3857",
  tokenMode: "path",
  tokenPathPlaceholder: DEFAULT_MAP_TOKEN_PATH_PLACEHOLDER,
});

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function demoRouteWkt(route: JsonObject, index: number) {
  const mapX = Number.isFinite(Number(route.mapX)) ? Number(route.mapX) : 25 + index * 25;
  const mapY = Number.isFinite(Number(route.mapY)) ? Number(route.mapY) : 35 + index * 12;
  const centerLon = TEL_AVIV_DEMO_CENTER.longitude + ((mapX - 50) / 50) * TEL_AVIV_DEMO_HALF_SPAN.longitude * 0.72;
  const centerLat = TEL_AVIV_DEMO_CENTER.latitude - ((mapY - 50) / 50) * TEL_AVIV_DEMO_HALF_SPAN.latitude * 0.72;
  const family = String(route.family ?? "SI").toUpperCase();
  const kind = String(route.routeKind ?? "single");
  const rotation = (Number(route.rotationDeg) || 0) * Math.PI / 180;
  const rotate = (x: number, y: number) => ({ x: x * Math.cos(rotation) - y * Math.sin(rotation), y: x * Math.sin(rotation) + y * Math.cos(rotation) });
  const toGeo = (x: number, y: number) => {
    const point = rotate(x, y);
    return [centerLon + point.x / (111_320 * Math.cos(centerLat * Math.PI / 180)), centerLat + point.y / 111_320] as const;
  };
  let local: { x: number; y: number }[];
  if (family === "SI") {
    local = Array.from({ length: 25 }, (_, pointIndex) => {
      const angle = pointIndex / 24 * Math.PI * 2;
      return { x: Math.cos(angle) * 145, y: Math.sin(angle) * 145 };
    });
  } else if (kind === "double") {
    // One continuous bent Double. The two logical hippodrome axes are ±15°.
    const a = 15 * Math.PI / 180;
    local = [
      { x: -220 * Math.cos(a), y: -220 * Math.sin(a) - 45 },
      { x: 0, y: -45 },
      { x: 220 * Math.cos(a), y: -220 * Math.sin(a) - 45 },
      { x: 255 * Math.cos(a), y: -220 * Math.sin(a) },
      { x: 220 * Math.cos(a), y: -220 * Math.sin(a) + 45 },
      { x: 0, y: 45 },
      { x: -220 * Math.cos(a), y: -220 * Math.sin(a) + 45 },
      { x: -255 * Math.cos(a), y: -220 * Math.sin(a) },
      { x: -220 * Math.cos(a), y: -220 * Math.sin(a) - 45 },
    ];
  } else {
    local = [
      { x: -150, y: -45 }, { x: 150, y: -45 }, { x: 195, y: 0 },
      { x: 150, y: 45 }, { x: -150, y: 45 }, { x: -195, y: 0 }, { x: -150, y: -45 },
    ];
  }
  return `LINESTRING(${local.map((point) => toGeo(point.x, point.y).map((value) => value.toFixed(7)).join(" ")).join(",")})`;
}

function ensureDemoRouteGeometry(state: JsonObject) {
  if (!Array.isArray(state.routes)) return;
  state.routes = state.routes.map((route, index) => {
    if (!isObject(route)) return route;
    const geometry = typeof route.geometry === "string" ? route.geometry.trim() : "";
    if (/^(LINESTRING|POLYGON)\b/i.test(geometry)) return route;
    return { ...route, geometry: demoRouteWkt(route, index), updatedAt: typeof route.updatedAt === "string" ? route.updatedAt : new Date().toISOString() };
  });
}

/**
 * One-way configuration migration: installations that predate the public WMTS
 * QA profile receive it as the initial default. Once the source exists, later
 * user choices are preserved and are never forced back to Omniscale.
 */
export function ensureTelAvivDemoMapState(value: unknown): unknown {
  if (!isObject(value)) return value;
  const state = structuredClone(value) as JsonObject;
  ensureDemoRouteGeometry(state);
  const currentSources = Array.isArray(state.mapServers) ? state.mapServers : [];
  const alreadyPresent = currentSources.some((source) => isObject(source) && source.id === DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  if (alreadyPresent) return state;

  const migratedSources = currentSources.map((source) => isObject(source) ? { ...source, isDefault: false } : source);
  state.mapServers = [{ ...DEFAULT_PUBLIC_WMTS_SOURCE, urlTemplate: DEFAULT_PUBLIC_WMTS_SOURCE.baseUrl }, ...migratedSources];
  const settings = isObject(state.settings) ? { ...state.settings } : {};
  settings.defaultMap = DEFAULT_PUBLIC_WMTS_SOURCE_ID;
  state.settings = settings;
  return state;
}

export function telAvivDemoBounds() {
  return {
    minLatitude: TEL_AVIV_DEMO_CENTER.latitude - TEL_AVIV_DEMO_HALF_SPAN.latitude,
    maxLatitude: TEL_AVIV_DEMO_CENTER.latitude + TEL_AVIV_DEMO_HALF_SPAN.latitude,
    minLongitude: TEL_AVIV_DEMO_CENTER.longitude - TEL_AVIV_DEMO_HALF_SPAN.longitude,
    maxLongitude: TEL_AVIV_DEMO_CENTER.longitude + TEL_AVIV_DEMO_HALF_SPAN.longitude,
  };
}
