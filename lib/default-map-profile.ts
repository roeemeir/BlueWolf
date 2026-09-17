import type { OperationalMapSource } from "./map-source-config";

export const TEL_AVIV_DEMO_CENTER = Object.freeze({ latitude: 32.0853, longitude: 34.7818 });
export const TEL_AVIV_DEMO_HALF_SPAN = Object.freeze({ latitude: 0.035, longitude: 0.055 });

export const DEFAULT_PUBLIC_WMTS_SOURCE_ID = "omniscale-demo";

/**
 * Public interoperability profile used only as the out-of-box QA/demo basemap.
 * `demo` is Omniscale's documented public test API key, so it is intentionally
 * part of the public capabilities URL and is not treated as a private secret.
 * Private/operational map-server credentials still use the SQLite secret store.
 */
export const DEFAULT_PUBLIC_WMTS_SOURCE: OperationalMapSource = Object.freeze({
  id: DEFAULT_PUBLIC_WMTS_SOURCE_ID,
  name: "Omniscale OSM · תל אביב · WMTS QA",
  kind: "wmts",
  baseUrl: "https://maps.omniscale.net/v2/demo/WMTSCapabilities.xml",
  attribution: "© Omniscale 2026 – Map data: OpenStreetMap (License ODbL)",
  enabled: true,
  isDefault: true,
  layer: "osm",
  style: "default",
  format: "image/png",
  version: "1.0.0",
  crs: "EPSG:3857",
  tileMatrixSet: "EPSG:3857",
  tokenMode: "none",
});

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * One-way configuration migration: installations that predate the public WMTS
 * QA profile receive it as the initial default. Once the source exists, later
 * user choices are preserved and are never forced back to Omniscale.
 */
export function ensureTelAvivDemoMapState(value: unknown): unknown {
  if (!isObject(value)) return value;
  const state = structuredClone(value) as JsonObject;
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
