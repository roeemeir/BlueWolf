export type MapSourceKind = "xyz" | "wms" | "wmts";
export type MapTokenMode = "none" | "bearer" | "query";

export type OperationalMapSource = {
  id: string;
  name: string;
  kind: MapSourceKind;
  baseUrl: string;
  attribution: string;
  enabled: boolean;
  isDefault: boolean;
  layer?: string;
  style?: string;
  format?: string;
  version?: string;
  crs?: string;
  tileMatrixSet?: string;
  tokenMode: MapTokenMode;
  tokenQueryParam?: string;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function text(value: unknown, label: string, fallback?: string) {
  const result = value === undefined && fallback !== undefined ? fallback : value;
  if (typeof result !== "string" || !result.trim()) throw new Error(`${label} is required`);
  return result.trim();
}

function optionalText(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("optional map source field must be text");
  return value.trim() || undefined;
}

function parsedHttpUrl(raw: string, label: string) {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error(`${label} must be a valid URL`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${label} must use http or https`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not embed credentials`);
  return parsed;
}

function mapBaseUrl(value: unknown, kind: MapSourceKind, label: string) {
  const raw = text(value, label);
  if (kind === "xyz") {
    // Validate scheme/host/credentials before placeholder completeness.  A URL
    // containing user-info is a secret-handling violation regardless of whether
    // the XYZ template is otherwise well-formed.
    parsedHttpUrl(raw.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0"), label);
    for (const placeholder of ["{z}", "{x}", "{y}"]) if (!raw.includes(placeholder)) throw new Error(`${label} XYZ template must include ${placeholder}`);
    return raw;
  }
  return parsedHttpUrl(raw, label).toString();
}

export function normalizeMapSource(value: unknown, index = 0): OperationalMapSource {
  const row = object(value, `map source ${index + 1}`);
  if ("token" in row || "secret" in row || "password" in row) {
    throw new Error(`map source ${index + 1} must not store plaintext credentials in workspace state`);
  }
  const id = text(row.id, "map source id");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("map source id contains unsupported characters");
  const kindRaw = row.kind ?? "xyz";
  if (kindRaw !== "xyz" && kindRaw !== "wms" && kindRaw !== "wmts") throw new Error(`map source ${id} has unsupported kind`);
  const kind = kindRaw as MapSourceKind;
  const legacyUrl = row.baseUrl ?? row.urlTemplate;
  const baseUrl = mapBaseUrl(legacyUrl, kind, `map source ${id} URL`);
  const tokenModeRaw = row.tokenMode ?? "none";
  if (tokenModeRaw !== "none" && tokenModeRaw !== "bearer" && tokenModeRaw !== "query") throw new Error(`map source ${id} has unsupported token mode`);
  const tokenMode = tokenModeRaw as MapTokenMode;
  const tokenQueryParam = optionalText(row.tokenQueryParam);
  if (tokenMode === "query") {
    if (!tokenQueryParam || !/^[A-Za-z0-9_.-]{1,64}$/.test(tokenQueryParam)) throw new Error(`map source ${id} query-token parameter is invalid`);
  }
  const layer = optionalText(row.layer);
  const tileMatrixSet = optionalText(row.tileMatrixSet);
  if ((kind === "wms" || kind === "wmts") && !layer) throw new Error(`map source ${id} requires a layer`);
  if (kind === "wmts" && !tileMatrixSet) throw new Error(`map source ${id} requires a tileMatrixSet`);
  const crs = optionalText(row.crs) ?? (kind === "wms" ? "CRS:84" : undefined);
  if (kind === "wms" && crs !== "CRS:84" && crs !== "EPSG:4326") throw new Error(`map source ${id} WMS currently supports CRS:84 or EPSG:4326`);
  return {
    id,
    name: text(row.name, `map source ${id} name`),
    kind,
    baseUrl,
    attribution: typeof row.attribution === "string" ? row.attribution.trim() : "",
    enabled: row.enabled !== false,
    isDefault: row.isDefault === true,
    layer,
    style: optionalText(row.style) ?? "",
    format: optionalText(row.format) ?? "image/png",
    version: optionalText(row.version) ?? (kind === "wms" ? "1.3.0" : kind === "wmts" ? "1.0.0" : undefined),
    crs,
    tileMatrixSet,
    tokenMode,
    tokenQueryParam,
  };
}

export function normalizeMapSources(value: unknown): OperationalMapSource[] {
  if (!Array.isArray(value)) throw new Error("mapServers must be an array");
  const sources = value.map(normalizeMapSource);
  const ids = new Set<string>();
  let defaults = 0;
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`duplicate map source id: ${source.id}`);
    ids.add(source.id);
    if (source.isDefault && source.enabled) defaults += 1;
  }
  if (defaults > 1) throw new Error("only one enabled map source may be default");
  return sources;
}

export type WmsProxyRequest = { bbox: [number, number, number, number]; width: number; height: number };
export type WmtsProxyRequest = { tileMatrix: string; tileRow: number; tileCol: number };

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function positiveInteger(value: number, label: string, max = 4096) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer in [1,${max}]`);
  return value;
}

export function buildWmsUpstreamUrl(source: OperationalMapSource, request: WmsProxyRequest) {
  if (source.kind !== "wms") throw new Error("map source is not WMS");
  const [minX, minY, maxX, maxY] = request.bbox.map((value, index) => finite(value, `bbox[${index}]`));
  if (!(minX < maxX && minY < maxY)) throw new Error("WMS bbox must have positive area");
  const url = new URL(source.baseUrl);
  const version = source.version ?? "1.3.0";
  const crs = source.crs ?? "CRS:84";
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("REQUEST", "GetMap");
  url.searchParams.set("VERSION", version);
  url.searchParams.set("LAYERS", source.layer ?? "");
  url.searchParams.set("STYLES", source.style ?? "");
  url.searchParams.set("FORMAT", source.format ?? "image/png");
  url.searchParams.set("TRANSPARENT", "TRUE");
  const crsKey = version.startsWith("1.3") ? "CRS" : "SRS";
  url.searchParams.set(crsKey, crs);
  const axisSwap = version.startsWith("1.3") && crs === "EPSG:4326";
  url.searchParams.set("BBOX", axisSwap ? `${minY},${minX},${maxY},${maxX}` : `${minX},${minY},${maxX},${maxY}`);
  url.searchParams.set("WIDTH", String(positiveInteger(request.width, "WMS width")));
  url.searchParams.set("HEIGHT", String(positiveInteger(request.height, "WMS height")));
  return url;
}

export function buildWmtsUpstreamUrl(source: OperationalMapSource, request: WmtsProxyRequest) {
  if (source.kind !== "wmts") throw new Error("map source is not WMTS");
  if (!request.tileMatrix || request.tileMatrix.length > 80) throw new Error("WMTS tileMatrix is invalid");
  if (!Number.isInteger(request.tileRow) || request.tileRow < 0) throw new Error("WMTS tileRow must be a non-negative integer");
  if (!Number.isInteger(request.tileCol) || request.tileCol < 0) throw new Error("WMTS tileCol must be a non-negative integer");
  const url = new URL(source.baseUrl);
  url.searchParams.set("SERVICE", "WMTS");
  url.searchParams.set("REQUEST", "GetTile");
  url.searchParams.set("VERSION", source.version ?? "1.0.0");
  url.searchParams.set("LAYER", source.layer ?? "");
  url.searchParams.set("STYLE", source.style ?? "");
  url.searchParams.set("FORMAT", source.format ?? "image/png");
  url.searchParams.set("TILEMATRIXSET", source.tileMatrixSet ?? "");
  url.searchParams.set("TILEMATRIX", request.tileMatrix);
  url.searchParams.set("TILEROW", String(request.tileRow));
  url.searchParams.set("TILECOL", String(request.tileCol));
  return url;
}

export function buildXyzUpstreamUrl(source: OperationalMapSource, z: number, x: number, y: number) {
  if (source.kind !== "xyz") throw new Error("map source is not XYZ");
  for (const [value, label] of [[z, "z"], [x, "x"], [y, "y"]] as const) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`XYZ ${label} must be a non-negative integer`);
  }
  const raw = source.baseUrl.replaceAll("{z}", String(z)).replaceAll("{x}", String(x)).replaceAll("{y}", String(y));
  if (/\{[zxy]\}/.test(raw)) throw new Error("XYZ URL template is missing z/x/y placeholders");
  return parsedHttpUrl(raw, "XYZ tile URL");
}

export function applyMapSourceToken(url: URL, source: OperationalMapSource, token: string | null) {
  const headers = new Headers();
  if (source.tokenMode === "none") return { url, headers };
  if (!token) throw new Error(`map source ${source.id} requires a configured token`);
  if (source.tokenMode === "bearer") headers.set("authorization", `Bearer ${token}`);
  else url.searchParams.set(source.tokenQueryParam ?? "token", token);
  return { url, headers };
}
