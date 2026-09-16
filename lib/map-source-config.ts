import {
  defaultWmtsLayerSelections,
  validateWmtsSelections,
  wmtsResourceTemplate,
  type WmtsCapabilitiesCatalog,
  type WmtsLayerSelection,
} from "./wmts-capabilities";

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
  wmtsCatalog?: WmtsCapabilitiesCatalog;
  wmtsLayers?: WmtsLayerSelection[];
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
    parsedHttpUrl(raw.replaceAll("{z}", "0").replaceAll("{x}", "0").replaceAll("{y}", "0"), label);
    for (const placeholder of ["{z}", "{x}", "{y}"]) if (!raw.includes(placeholder)) throw new Error(`${label} XYZ template must include ${placeholder}`);
    return raw;
  }
  return parsedHttpUrl(raw, label).toString();
}

function catalogFromUnknown(value: unknown, sourceId: string): WmtsCapabilitiesCatalog | undefined {
  if (value === undefined || value === null) return undefined;
  const row = object(value, `map source ${sourceId} WMTS catalog`);
  if (!Array.isArray(row.layers) || !Array.isArray(row.tileMatrixSets) || !Array.isArray(row.getTileKvpUrls)) throw new Error(`map source ${sourceId} WMTS catalog is invalid`);
  for (const endpoint of row.getTileKvpUrls) if (typeof endpoint !== "string") throw new Error(`map source ${sourceId} WMTS KVP endpoint is invalid`);
  return value as WmtsCapabilitiesCatalog;
}

function selectionsFromUnknown(value: unknown, sourceId: string): WmtsLayerSelection[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`map source ${sourceId} WMTS layers must be an array`);
  return value.map((item, index) => {
    const row = object(item, `map source ${sourceId} WMTS layer ${index + 1}`);
    return {
      layer: text(row.layer, "WMTS layer"),
      style: text(row.style, "WMTS style", "default"),
      format: text(row.format, "WMTS format", "image/png"),
      tileMatrixSet: text(row.tileMatrixSet, "WMTS TileMatrixSet"),
      enabled: row.enabled === true,
      order: typeof row.order === "number" ? row.order : index,
      opacity: typeof row.opacity === "number" ? row.opacity : 1,
    };
  });
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
  const wmtsCatalog = kind === "wmts" ? catalogFromUnknown(row.wmtsCatalog, id) : undefined;
  const storedSelections = kind === "wmts" ? selectionsFromUnknown(row.wmtsLayers, id) : undefined;
  const wmtsLayers = wmtsCatalog
    ? validateWmtsSelections(wmtsCatalog, storedSelections ?? defaultWmtsLayerSelections(wmtsCatalog))
    : storedSelections;
  if (kind === "wms" && !layer) throw new Error(`map source ${id} requires a layer`);
  if (kind === "wmts" && !wmtsCatalog && !layer) throw new Error(`map source ${id} requires GetCapabilities discovery or a legacy layer`);
  if (kind === "wmts" && !wmtsCatalog && !tileMatrixSet) throw new Error(`map source ${id} requires GetCapabilities discovery or a legacy tileMatrixSet`);
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
    wmtsCatalog,
    wmtsLayers,
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
export type WmtsProxyRequest = {
  tileMatrix: string;
  tileRow: number;
  tileCol: number;
  layer?: string;
  style?: string;
  format?: string;
  tileMatrixSet?: string;
  resourceTemplate?: string;
  kvpUrl?: string;
};

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

export function buildWmtsCapabilitiesUrl(source: Pick<OperationalMapSource, "kind" | "baseUrl" | "version">) {
  if (source.kind !== "wmts") throw new Error("map source is not WMTS");
  const url = new URL(source.baseUrl);
  url.searchParams.set("SERVICE", "WMTS");
  url.searchParams.set("REQUEST", "GetCapabilities");
  url.searchParams.set("VERSION", source.version ?? "1.0.0");
  return url;
}

function replaceTemplateToken(value: string, token: string, replacement: string) {
  return value.replace(new RegExp(`\\{${token}\\}`, "gi"), encodeURIComponent(replacement));
}

export function resolveWmtsLayer(source: OperationalMapSource, requestedLayer?: string) {
  if (source.kind !== "wmts") throw new Error("map source is not WMTS");
  if (source.wmtsCatalog) {
    const selections = validateWmtsSelections(source.wmtsCatalog, source.wmtsLayers ?? defaultWmtsLayerSelections(source.wmtsCatalog));
    const selection = requestedLayer
      ? selections.find((item) => item.layer === requestedLayer)
      : selections.find((item) => item.enabled);
    if (!selection) throw new Error(requestedLayer ? `WMTS layer ${requestedLayer} is not configured` : "WMTS source has no enabled default layer");
    const layer = source.wmtsCatalog.layers.find((item) => item.identifier === selection.layer);
    if (!layer) throw new Error(`WMTS layer ${selection.layer} is missing from catalog`);
    return {
      ...selection,
      resourceTemplate: wmtsResourceTemplate(layer, selection.format),
      kvpUrl: source.wmtsCatalog.getTileKvpUrls[0],
    };
  }
  if (requestedLayer && requestedLayer !== source.layer) throw new Error(`WMTS layer ${requestedLayer} is not configured`);
  return {
    layer: source.layer ?? "",
    style: source.style ?? "",
    format: source.format ?? "image/png",
    tileMatrixSet: source.tileMatrixSet ?? "",
    enabled: true,
    order: 0,
    opacity: 1,
    resourceTemplate: undefined,
    kvpUrl: undefined,
  };
}

export function buildWmtsUpstreamUrl(source: OperationalMapSource, request: WmtsProxyRequest) {
  if (source.kind !== "wmts") throw new Error("map source is not WMTS");
  if (!request.tileMatrix || request.tileMatrix.length > 160) throw new Error("WMTS tileMatrix is invalid");
  if (!Number.isInteger(request.tileRow) || request.tileRow < 0) throw new Error("WMTS tileRow must be a non-negative integer");
  if (!Number.isInteger(request.tileCol) || request.tileCol < 0) throw new Error("WMTS tileCol must be a non-negative integer");
  const layer = request.layer ?? source.layer ?? "";
  const style = request.style ?? source.style ?? "";
  const format = request.format ?? source.format ?? "image/png";
  const tileMatrixSet = request.tileMatrixSet ?? source.tileMatrixSet ?? "";
  if (!layer || !tileMatrixSet) throw new Error("WMTS request is missing layer or TileMatrixSet");
  if (request.resourceTemplate) {
    let raw = request.resourceTemplate;
    raw = replaceTemplateToken(raw, "Layer", layer);
    raw = replaceTemplateToken(raw, "Style", style);
    raw = replaceTemplateToken(raw, "TileMatrixSet", tileMatrixSet);
    raw = replaceTemplateToken(raw, "TileMatrix", request.tileMatrix);
    raw = replaceTemplateToken(raw, "TileRow", String(request.tileRow));
    raw = replaceTemplateToken(raw, "TileCol", String(request.tileCol));
    return parsedHttpUrl(raw, "WMTS ResourceURL");
  }
  const url = new URL(request.kvpUrl ?? source.baseUrl);
  url.searchParams.set("SERVICE", "WMTS");
  url.searchParams.set("REQUEST", "GetTile");
  url.searchParams.set("VERSION", source.version ?? "1.0.0");
  url.searchParams.set("LAYER", layer);
  url.searchParams.set("STYLE", style);
  url.searchParams.set("FORMAT", format);
  url.searchParams.set("TILEMATRIXSET", tileMatrixSet);
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
