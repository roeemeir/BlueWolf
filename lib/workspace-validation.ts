import type { InfluxSettings, VehicleType } from "./bluewolf";
import { validateInfluxSettings } from "./influx-runtime-config";
import { normalizeMapSources } from "./map-source-config";
import { formatRouteWkt, parseRouteWkt } from "./route-wkt";
import { validateVehicleIdRanges } from "./vehicle-id-ranges";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRoutes(state: JsonObject) {
  if (!Array.isArray(state.routes)) return;
  state.routes = state.routes.map((route, index) => {
    if (!isObject(route)) throw new Error(`route ${index + 1} must be an object`);
    const next = { ...route };
    const geometry = next.geometry;
    if (typeof geometry !== "string" || !geometry.trim()) throw new Error(`route ${index + 1} geometry is missing`);
    if (/^\s*(LINESTRING|POLYGON)\b/i.test(geometry)) {
      next.geometry = formatRouteWkt(parseRouteWkt(geometry));
    }
    return next;
  });
}

function validateVehicleRanges(state: JsonObject) {
  if (!Array.isArray(state.vehicleTypes)) return;
  const ranges = state.vehicleTypes.map((value, index) => {
    if (!isObject(value)) throw new Error(`vehicle type ${index + 1} must be an object`);
    return {
      id: String(value.id ?? `vehicle-${index + 1}`),
      name: String(value.name ?? index + 1),
      minId: Number(value.minId),
      maxId: Number(value.maxId),
      workSpeedKmh: Number(value.workSpeedKmh),
    } as Pick<VehicleType, "id" | "name" | "minId" | "maxId" | "workSpeedKmh">;
  });
  validateVehicleIdRanges(ranges);
}

function validateInflux(state: JsonObject) {
  if (state.influx === undefined) return;
  if (!isObject(state.influx)) throw new Error("influx must be an object");
  validateInfluxSettings(state.influx as unknown as InfluxSettings);
}

function validateMapSources(state: JsonObject) {
  if (state.mapServers === undefined) return;
  state.mapServers = normalizeMapSources(state.mapServers).map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.kind,
    baseUrl: source.baseUrl,
    urlTemplate: source.baseUrl,
    attribution: source.attribution,
    enabled: source.enabled,
    isDefault: source.isDefault,
    layer: source.layer,
    style: source.style,
    format: source.format,
    version: source.version,
    crs: source.crs,
    tileMatrixSet: source.tileMatrixSet,
    tokenMode: source.tokenMode,
    tokenQueryParam: source.tokenQueryParam,
  }));
}

/**
 * Server-side canonicalization/validation before either SQLite or D1 persistence.
 * Legacy non-WKT route sentinels remain readable during migration, while every
 * WKT geometry is parsed and normalized before it can become persisted truth.
 * IN-01 is validated here as well so labels cannot be saved independently from
 * the actual stream columns and value transformations consumed by the runtime.
 * BW-OFF-010 map source metadata is normalized here, while map tokens are
 * deliberately rejected from workspace JSON and live only in local server-side
 * secret storage.
 */
export function normalizeAndValidateWorkspaceState(value: unknown): unknown {
  if (!isObject(value)) throw new Error("workspace state must be an object");
  const state = structuredClone(value) as JsonObject;
  normalizeRoutes(state);
  validateVehicleRanges(state);
  validateInflux(state);
  validateMapSources(state);
  return state;
}
