import type { InfluxFieldMapping, InfluxSettings } from "./bluewolf";

export const MAX_NOMINAL_LIVE_LATENCY_SECONDS = 10;

const RUNTIME_METRICS: Record<string, string | null> = {
  vehicleNumber: null,
  uniqueVehicleId: "vehicle_identifier",
  active: "active",
  latitude: "latitude_deg",
  longitude: "longitude_deg",
  altitude: "altitude_m",
  velocityNorth: "velocity_north_mps",
  velocityEast: "velocity_east_mps",
};

const REQUIRED_RUNTIME_METRICS = new Set([
  "vehicle_identifier",
  "active",
  "latitude_deg",
  "longitude_deg",
  "velocity_north_mps",
  "velocity_east_mps",
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as JsonObject;
}

function optionalObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function finitePositive(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

export function nominalLiveLatencySeconds(influx: InfluxSettings, uiRefreshSeconds: number) {
  const joinToleranceSeconds = finitePositive(influx.joinToleranceSeconds, "influx.joinToleranceSeconds");
  const activePollSeconds = finitePositive(influx.activePollSeconds, "influx.activePollSeconds");
  const refreshSeconds = finitePositive(uiRefreshSeconds, "settings.uiRefreshSeconds");
  return joinToleranceSeconds + activePollSeconds + refreshSeconds;
}

export function validateLiveLatencyBudget(influx: InfluxSettings, uiRefreshSeconds: number) {
  const total = nominalLiveLatencySeconds(influx, uiRefreshSeconds);
  if (total > MAX_NOMINAL_LIVE_LATENCY_SECONDS) {
    throw new Error(
      `BW-DATA-010 live latency budget exceeds ${MAX_NOMINAL_LIVE_LATENCY_SECONDS}s: ` +
      `${influx.joinToleranceSeconds}s join + ${influx.activePollSeconds}s poll + ${uiRefreshSeconds}s UI = ${total}s`,
    );
  }
  return total;
}

function mappedScalar(value: string): string | number | boolean {
  const normalized = value.trim();
  if (!normalized) throw new Error("mapped value must be non-empty");
  if (/^true$/i.test(normalized)) return true;
  if (/^false$/i.test(normalized)) return false;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && normalized !== "") return numeric;
  return normalized;
}

function runtimeMetric(mapping: InfluxFieldMapping, index: number) {
  if (!(mapping.systemKey in RUNTIME_METRICS)) throw new Error(`influx.mappings[${index}].systemKey is unsupported`);
  return RUNTIME_METRICS[mapping.systemKey];
}

export function validateInfluxSettings(influx: InfluxSettings) {
  text(influx.url, "influx.url");
  text(influx.organization, "influx.organization");
  const columns = [
    text(influx.stream.serverColumn, "influx.stream.serverColumn"),
    text(influx.stream.timeColumn, "influx.stream.timeColumn"),
    text(influx.stream.vehicleNumberColumn, "influx.stream.vehicleNumberColumn"),
  ];
  if (new Set(columns).size !== columns.length) throw new Error("Influx join columns for server, time and vehicle number must be distinct");
  finitePositive(influx.idleProbeMinutes, "influx.idleProbeMinutes");
  finitePositive(influx.activePollSeconds, "influx.activePollSeconds");
  finitePositive(influx.joinToleranceSeconds, "influx.joinToleranceSeconds");
  if (!Array.isArray(influx.mappings) || !influx.mappings.length) throw new Error("influx.mappings must not be empty");

  const systemKeys = new Set<string>();
  const runtimeMetrics = new Set<string>();
  influx.mappings.forEach((mapping, index) => {
    if (!mapping || typeof mapping !== "object") throw new Error(`influx.mappings[${index}] must be an object`);
    if (systemKeys.has(mapping.systemKey)) throw new Error(`duplicate Influx systemKey: ${mapping.systemKey}`);
    systemKeys.add(mapping.systemKey);
    text(mapping.bucket, `influx.mappings[${index}].bucket`);
    text(mapping.measurement, `influx.mappings[${index}].measurement`);
    text(mapping.key, `influx.mappings[${index}].key`);
    if (mapping.valueMode !== "as-is" && mapping.valueMode !== "special") throw new Error(`influx.mappings[${index}].valueMode is invalid`);
    if (mapping.fillMode !== "forward-fill" && mapping.fillMode !== "linear") throw new Error(`influx.mappings[${index}].fillMode is invalid`);
    if (mapping.valueMode === "special") {
      text(mapping.sourceValue, `influx.mappings[${index}].sourceValue`);
      mappedScalar(mapping.mappedValue);
    }
    const metric = runtimeMetric(mapping, index);
    if (metric) {
      if (runtimeMetrics.has(metric)) throw new Error(`Influx runtime metric is mapped more than once: ${metric}`);
      runtimeMetrics.add(metric);
    }
  });
  const missing = [...REQUIRED_RUNTIME_METRICS].filter((metric) => !runtimeMetrics.has(metric));
  if (missing.length) throw new Error(`Influx mappings are missing required runtime metrics: ${missing.join(", ")}`);
}

function operationalMetric(mapping: InfluxFieldMapping, index: number, existingMetrics: JsonObject[]) {
  const metric = runtimeMetric(mapping, index);
  if (!metric) return null;
  const previous = existingMetrics.find((row) => row.metric === metric) ?? {};
  const row: JsonObject = {
    ...previous,
    metric,
    bucket: mapping.bucket.trim(),
    measurement: mapping.measurement.trim(),
    field: mapping.key.trim(),
  };
  if (mapping.valueMode === "special") {
    const previousMap = optionalObject(previous.valueMap) ?? {};
    row.valueMap = { ...previousMap, [mapping.sourceValue.trim()]: mappedScalar(mapping.mappedValue) };
  } else {
    delete row.valueMap;
  }
  return row;
}

export function buildOperationalInfluxConfig(existingConfig: unknown, influx: InfluxSettings) {
  validateInfluxSettings(influx);
  const root = structuredClone(object(existingConfig, "operational config"));
  const existingInflux = object(root.influx, "operational config.influx");
  const existingStream = optionalObject(existingInflux.stream) ?? {};
  const existingJoin = optionalObject(root.join) ?? {};
  const existingPolling = optionalObject(root.polling) ?? {};
  const existingMetrics = Array.isArray(existingInflux.metrics)
    ? existingInflux.metrics.map((row, index) => object(row, `operational config.influx.metrics[${index}]`))
    : [];
  const metrics = influx.mappings.map((mapping, index) => operationalMetric(mapping, index, existingMetrics)).filter((row): row is JsonObject => row !== null);

  root.influx = {
    ...existingInflux,
    url: influx.url.trim(),
    organization: influx.organization.trim(),
    tokenEnv: typeof existingInflux.tokenEnv === "string" && existingInflux.tokenEnv.trim() ? existingInflux.tokenEnv : "BLUEWOLF_INFLUX_TOKEN",
    stream: {
      ...existingStream,
      serverColumn: influx.stream.serverColumn.trim(),
      timeColumn: influx.stream.timeColumn.trim(),
      vehicleNumberColumn: influx.stream.vehicleNumberColumn.trim(),
    },
    metrics,
  };
  root.join = { ...existingJoin, toleranceSeconds: influx.joinToleranceSeconds };
  root.polling = {
    ...existingPolling,
    activePollSeconds: influx.activePollSeconds,
    idleProbeSeconds: influx.idleProbeMinutes * 60,
    joinToleranceSeconds: influx.joinToleranceSeconds,
  };
  return root;
}