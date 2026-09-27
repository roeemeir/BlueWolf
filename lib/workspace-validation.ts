import type { InfluxSettings, SiPosition, VehicleType } from "./bluewolf";
import { validateInfluxSettings, validateLiveLatencyBudget } from "./influx-runtime-config";
import { normalizeMapSources } from "./map-source-config";
import { formatRouteWkt, parseRouteWkt } from "./route-wkt";
import { validateSiPositions } from "./si-direct-placement";
import { validatePersistedSoTemplate } from "./so-persisted-validation";
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

function vehicleTypesFromState(state: JsonObject): VehicleType[] {
  if (!Array.isArray(state.vehicleTypes)) return [];
  return state.vehicleTypes.map((value, index) => {
    if (!isObject(value)) throw new Error(`vehicle type ${index + 1} must be an object`);
    if (!Array.isArray(value.siRoles) || value.siRoles.some((role) => role !== "inner" && role !== "middle" && role !== "outer")) {
      throw new Error(`vehicle type ${index + 1} siRoles are invalid`);
    }
    return value as unknown as VehicleType;
  });
}

function validateVehicleRanges(state: JsonObject) {
  if (!Array.isArray(state.vehicleTypes)) return;
  const ranges = state.vehicleTypes.map((value, index) => {
    if (!isObject(value)) throw new Error(`vehicle type ${index + 1} must be an object`);
    const rawRanges = Array.isArray(value.idRanges) ? value.idRanges : undefined;
    const idRanges = rawRanges?.map((rawRange, rangeIndex) => {
      if (!isObject(rawRange)) throw new Error(`vehicle type ${index + 1} range ${rangeIndex + 1} must be an object`);
      return { minId: Number(rawRange.minId), maxId: Number(rawRange.maxId) };
    });
    return {
      id: String(value.id ?? `vehicle-${index + 1}`),
      name: String(value.name ?? index + 1),
      minId: Number(value.minId),
      maxId: Number(value.maxId),
      idRanges,
      workSpeedKmh: Number(value.workSpeedKmh),
    } as Pick<VehicleType, "id" | "name" | "minId" | "maxId" | "idRanges" | "workSpeedKmh">;
  });
  validateVehicleIdRanges(ranges);
}

function validateTemplates(state: JsonObject) {
  if (state.templates === undefined) return;
  if (!Array.isArray(state.templates)) throw new Error("templates must be an array");
  const vehicleTypes = vehicleTypesFromState(state);
  const ids = new Set<string>();
  state.templates.forEach((value, index) => {
    if (!isObject(value)) throw new Error(`template ${index + 1} must be an object`);
    if (typeof value.id !== "string" || !value.id.trim()) throw new Error(`template ${index + 1} id is required`);
    if (ids.has(value.id)) throw new Error(`duplicate template id: ${value.id}`);
    ids.add(value.id);
    // New SO direct-placements are physical source truth, not unvalidated UI metadata.
    // Legacy relation-only SO stays readable until the user explicitly authors slots.
    validatePersistedSoTemplate(value);
    if (value.family !== "SI" || value.siPositions === undefined) return;
    if (!Array.isArray(value.siPositions)) throw new Error(`${value.id}.siPositions must be an array`);
    const positions = value.siPositions.map((raw, positionIndex) => {
      if (!isObject(raw)) throw new Error(`${value.id}.siPositions[${positionIndex}] must be an object`);
      if (typeof raw.typeId !== "string" || !raw.typeId.trim()) throw new Error(`${value.id}.siPositions[${positionIndex}].typeId is required`);
      if (raw.ring !== "inner" && raw.ring !== "middle" && raw.ring !== "outer") throw new Error(`${value.id}.siPositions[${positionIndex}].ring is invalid`);
      if (typeof raw.angleDeg !== "number" || !Number.isFinite(raw.angleDeg)) throw new Error(`${value.id}.siPositions[${positionIndex}].angleDeg must be finite`);
      return { typeId: raw.typeId, ring: raw.ring, angleDeg: raw.angleDeg } satisfies SiPosition;
    });
    const validation = validateSiPositions(positions, vehicleTypes);
    if (validation) throw new Error(`${value.id}: ${validation}`);
  });
}

function validateInflux(state: JsonObject) {
  if (state.influx === undefined) return;
  if (!isObject(state.influx)) throw new Error("influx must be an object");
  validateInfluxSettings(state.influx as unknown as InfluxSettings);
}

function validateLatencyBudget(state: JsonObject) {
  if (state.influx === undefined || state.settings === undefined) return;
  if (!isObject(state.influx)) throw new Error("influx must be an object");
  if (!isObject(state.settings)) throw new Error("settings must be an object");
  if (state.settings.uiRefreshSeconds === undefined) return;
  validateLiveLatencyBudget(
    state.influx as unknown as InfluxSettings,
    Number(state.settings.uiRefreshSeconds),
  );
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
    wmtsCatalog: source.wmtsCatalog,
    wmtsLayers: source.wmtsLayers,
  }));
}

/**
 * Server-side canonicalization/validation before either SQLite or D1 persistence.
 * Legacy non-WKT route sentinels remain readable during migration, while every
 * WKT geometry is parsed and normalized before it can become persisted truth.
 * IN-01 is validated here as well so labels cannot be saved independently from
 * the actual stream columns and value transformations consumed by the runtime.
 * BW-DATA-010 is enforced across join tolerance, active polling and UI refresh
 * so a saved operational configuration cannot silently exceed the 10s nominal
 * live-display latency budget.
 * BW-OFF-010 map source metadata, discovered capabilities and default layer
 * selections are normalized here, while private map tokens are deliberately
 * rejected from workspace JSON and live only in local server-side secret storage.
 * BW-SYNC-012 coordinate-authored SI templates are validated against the same
 * 30-degree/ring/type rules used by the editor before they may become persisted
 * runtime truth. Legacy SI templates without siPositions remain readable but are
 * never reverse-engineered into operational coordinates.
 * Schema-versioned SO placements must have valid route, phase, direction and
 * derived relation/values evidence before either storage backend may accept them.
 */
export function normalizeAndValidateWorkspaceState(value: unknown): unknown {
  if (!isObject(value)) throw new Error("workspace state must be an object");
  const state = structuredClone(value) as JsonObject;
  normalizeRoutes(state);
  validateVehicleRanges(state);
  validateTemplates(state);
  validateInflux(state);
  validateLatencyBudget(state);
  validateMapSources(state);
  return state;
}
