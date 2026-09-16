import type { OperationalProjection } from "./operational-map-projection";

export type WmtsStyle = { identifier: string; title?: string; isDefault: boolean };
export type WmtsResourceUrl = { format?: string; resourceType?: string; template: string };
export type WmtsLayer = {
  identifier: string;
  title?: string;
  styles: WmtsStyle[];
  formats: string[];
  tileMatrixSets: string[];
  resourceUrls: WmtsResourceUrl[];
};
export type WmtsTileMatrix = {
  identifier: string;
  scaleDenominator: number;
  topLeftCorner: [number, number];
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
};
export type WmtsTileMatrixSet = {
  identifier: string;
  title?: string;
  supportedCrs: string;
  wellKnownScaleSet?: string;
  matrices: WmtsTileMatrix[];
};
export type WmtsCapabilitiesCatalog = {
  version: string;
  serviceTitle?: string;
  getTileKvpUrls: string[];
  layers: WmtsLayer[];
  tileMatrixSets: WmtsTileMatrixSet[];
};
export type WmtsLayerSelection = {
  layer: string;
  style: string;
  format: string;
  tileMatrixSet: string;
  enabled: boolean;
  order: number;
  opacity: number;
};
export type WmtsProjectionKind = "webmercator" | "geographic";
export type WmtsScreenTile = {
  tileMatrix: string;
  tileRow: number;
  tileCol: number;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
};

type XmlBlock = { attrs: string; body: string };

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function blocks(xml: string, name: string): XmlBlock[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b([^>]*)>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`, "gi");
  return Array.from(xml.matchAll(re), (match) => ({ attrs: match[1] ?? "", body: match[2] ?? "" }));
}

function elements(xml: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b([^>]*)\\/?\\s*>`, "gi");
  return Array.from(xml.matchAll(re), (match) => match[1] ?? "");
}

function attr(attrs: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const match = attrs.match(re);
  return match ? decodeXml(match[2].trim()) : undefined;
}

function text(xml: string, name: string) {
  const block = blocks(xml, name)[0];
  if (!block) return undefined;
  const value = decodeXml(block.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  return value || undefined;
}

function texts(xml: string, name: string) {
  return blocks(xml, name)
    .map((block) => decodeXml(block.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()))
    .filter(Boolean);
}

function finiteNumber(value: string | undefined, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`WMTS ${label} is invalid`);
  return parsed;
}

function positiveInteger(value: string | undefined, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`WMTS ${label} is invalid`);
  return parsed;
}

function parseTopLeft(value: string | undefined): [number, number] {
  if (!value) throw new Error("WMTS TopLeftCorner is missing");
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item))) throw new Error("WMTS TopLeftCorner is invalid");
  return [parts[0], parts[1]];
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function parseWmtsCapabilities(xml: string): WmtsCapabilitiesCatalog {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("WMTS GetCapabilities response is empty");
  const rootMatch = xml.match(/<(?:(?:[\w.-]+):)?Capabilities\b([^>]*)>/i);
  if (!rootMatch) throw new Error("response is not a WMTS Capabilities document");
  const version = attr(rootMatch[1] ?? "", "version") ?? "1.0.0";
  const contents = blocks(xml, "Contents")[0]?.body;
  if (!contents) throw new Error("WMTS Capabilities does not contain Contents");

  const layers: WmtsLayer[] = blocks(contents, "Layer").map((layerBlock) => {
    const identifier = text(layerBlock.body, "Identifier");
    if (!identifier) throw new Error("WMTS layer is missing Identifier");
    const styles = blocks(layerBlock.body, "Style").map((styleBlock) => ({
      identifier: text(styleBlock.body, "Identifier") ?? "default",
      title: text(styleBlock.body, "Title"),
      isDefault: /^true$|^1$/i.test(attr(styleBlock.attrs, "isDefault") ?? ""),
    }));
    const tileMatrixSets = blocks(layerBlock.body, "TileMatrixSetLink")
      .map((link) => text(link.body, "TileMatrixSet"))
      .filter((value): value is string => Boolean(value));
    const resourceUrls = elements(layerBlock.body, "ResourceURL").flatMap((attrs) => {
      const template = attr(attrs, "template");
      if (!template) return [];
      return [{ format: attr(attrs, "format"), resourceType: attr(attrs, "resourceType"), template }];
    });
    return {
      identifier,
      title: text(layerBlock.body, "Title"),
      styles: styles.length ? styles : [{ identifier: "default", isDefault: true }],
      formats: unique(texts(layerBlock.body, "Format")),
      tileMatrixSets: unique(tileMatrixSets),
      resourceUrls,
    };
  });

  const tileMatrixSets: WmtsTileMatrixSet[] = blocks(contents, "TileMatrixSet").map((setBlock) => {
    const identifier = text(setBlock.body, "Identifier");
    const supportedCrs = text(setBlock.body, "SupportedCRS");
    if (!identifier || !supportedCrs) throw new Error("WMTS TileMatrixSet is missing Identifier or SupportedCRS");
    const matrices = blocks(setBlock.body, "TileMatrix").map((matrixBlock) => {
      const matrixId = text(matrixBlock.body, "Identifier");
      if (!matrixId) throw new Error(`WMTS TileMatrixSet ${identifier} contains a matrix without Identifier`);
      return {
        identifier: matrixId,
        scaleDenominator: finiteNumber(text(matrixBlock.body, "ScaleDenominator"), "ScaleDenominator"),
        topLeftCorner: parseTopLeft(text(matrixBlock.body, "TopLeftCorner")),
        tileWidth: positiveInteger(text(matrixBlock.body, "TileWidth"), "TileWidth"),
        tileHeight: positiveInteger(text(matrixBlock.body, "TileHeight"), "TileHeight"),
        matrixWidth: positiveInteger(text(matrixBlock.body, "MatrixWidth"), "MatrixWidth"),
        matrixHeight: positiveInteger(text(matrixBlock.body, "MatrixHeight"), "MatrixHeight"),
      };
    });
    return {
      identifier,
      title: text(setBlock.body, "Title"),
      supportedCrs,
      wellKnownScaleSet: text(setBlock.body, "WellKnownScaleSet"),
      matrices,
    };
  });

  const getTileKvpUrls = blocks(xml, "Operation")
    .filter((operation) => (attr(operation.attrs, "name") ?? "").toLowerCase() === "gettile")
    .flatMap((operation) => elements(operation.body, "Get").map((attrs) => attr(attrs, "href")).filter((value): value is string => Boolean(value)));

  if (!layers.length) throw new Error("WMTS Capabilities contains no layers");
  if (!tileMatrixSets.length) throw new Error("WMTS Capabilities contains no TileMatrixSets");
  return {
    version,
    serviceTitle: text(blocks(xml, "ServiceIdentification")[0]?.body ?? "", "Title"),
    getTileKvpUrls: unique(getTileKvpUrls),
    layers,
    tileMatrixSets,
  };
}

export function wmtsProjectionKind(supportedCrs: string): WmtsProjectionKind | null {
  const normalized = supportedCrs.toLowerCase().replace(/\s+/g, "");
  if (/(^|[^0-9])(3857|900913|102100)([^0-9]|$)/.test(normalized) || normalized.includes("googlemapscompatible")) return "webmercator";
  if (/(^|[^0-9])4326([^0-9]|$)/.test(normalized) || normalized.includes("crs84")) return "geographic";
  return null;
}

export function compatibleMatrixSets(catalog: WmtsCapabilitiesCatalog, layer: WmtsLayer) {
  return layer.tileMatrixSets.flatMap((id) => {
    const matrixSet = catalog.tileMatrixSets.find((item) => item.identifier === id);
    return matrixSet && wmtsProjectionKind(matrixSet.supportedCrs) ? [matrixSet] : [];
  });
}

export function defaultWmtsLayerSelections(catalog: WmtsCapabilitiesCatalog): WmtsLayerSelection[] {
  const rows: WmtsLayerSelection[] = [];
  catalog.layers.forEach((layer, index) => {
    const matrixSet = compatibleMatrixSets(catalog, layer)[0];
    if (!matrixSet) return;
    const style = layer.styles.find((item) => item.isDefault)?.identifier ?? layer.styles[0]?.identifier ?? "default";
    rows.push({
      layer: layer.identifier,
      style,
      format: layer.formats.find((item) => item.toLowerCase().startsWith("image/")) ?? layer.formats[0] ?? "image/png",
      tileMatrixSet: matrixSet.identifier,
      enabled: index === 0,
      order: rows.length,
      opacity: 1,
    });
  });
  return rows;
}

export function validateWmtsSelections(catalog: WmtsCapabilitiesCatalog, selections: readonly WmtsLayerSelection[]) {
  const seen = new Set<string>();
  return selections.map((selection, index) => {
    if (seen.has(selection.layer)) throw new Error(`duplicate WMTS default layer ${selection.layer}`);
    seen.add(selection.layer);
    const layer = catalog.layers.find((item) => item.identifier === selection.layer);
    if (!layer) throw new Error(`WMTS layer ${selection.layer} is not present in the saved catalog`);
    if (!layer.styles.some((item) => item.identifier === selection.style)) throw new Error(`WMTS style ${selection.style} is not valid for ${selection.layer}`);
    if (!layer.formats.includes(selection.format)) throw new Error(`WMTS format ${selection.format} is not valid for ${selection.layer}`);
    if (!layer.tileMatrixSets.includes(selection.tileMatrixSet)) throw new Error(`WMTS TileMatrixSet ${selection.tileMatrixSet} is not valid for ${selection.layer}`);
    const matrixSet = catalog.tileMatrixSets.find((item) => item.identifier === selection.tileMatrixSet);
    if (!matrixSet || !wmtsProjectionKind(matrixSet.supportedCrs)) throw new Error(`WMTS TileMatrixSet ${selection.tileMatrixSet} cannot be overlaid on the WGS84 Blue Wolf map`);
    const opacity = Number(selection.opacity);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`WMTS opacity for ${selection.layer} must be between 0 and 1`);
    const order = Number(selection.order);
    if (!Number.isInteger(order) || order < 0) throw new Error(`WMTS order for ${selection.layer} must be a non-negative integer`);
    return { ...selection, enabled: selection.enabled === true, opacity, order: Number.isInteger(order) ? order : index };
  }).sort((a, b) => a.order - b.order || a.layer.localeCompare(b.layer));
}

export function wmtsResourceTemplate(layer: WmtsLayer, format: string) {
  return layer.resourceUrls.find((item) => (item.resourceType ?? "tile").toLowerCase() === "tile" && (!item.format || item.format === format))?.template
    ?? layer.resourceUrls.find((item) => (item.resourceType ?? "tile").toLowerCase() === "tile")?.template;
}

function mercatorMeters(latitude: number, longitude: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = longitude * 20037508.342789244 / 180;
  const y = Math.log(Math.tan((90 + clamped) * Math.PI / 360)) / (Math.PI / 180) * 20037508.342789244 / 180;
  return { x, y };
}

function mercatorGeo(x: number, y: number) {
  const longitude = x / 20037508.342789244 * 180;
  const latitude = 180 / Math.PI * (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2);
  return { latitude, longitude };
}

function crsPoint(kind: WmtsProjectionKind, latitude: number, longitude: number) {
  return kind === "webmercator" ? mercatorMeters(latitude, longitude) : { x: longitude, y: latitude };
}

function geoPoint(kind: WmtsProjectionKind, x: number, y: number) {
  return kind === "webmercator" ? mercatorGeo(x, y) : { latitude: y, longitude: x };
}

export function wmtsScreenTiles(
  projection: OperationalProjection,
  matrixSet: WmtsTileMatrixSet,
  viewportWidth: number,
  viewportHeight: number,
  maxTiles = 96,
): WmtsScreenTile[] {
  const kind = wmtsProjectionKind(matrixSet.supportedCrs);
  const bounds = projection.viewGeoBounds;
  if (!kind || !bounds || projection.empty || !matrixSet.matrices.length) return [];
  const northWest = crsPoint(kind, bounds.maxLatitude, bounds.minLongitude);
  const southEast = crsPoint(kind, bounds.minLatitude, bounds.maxLongitude);
  const spanX = Math.abs(southEast.x - northWest.x);
  const spanY = Math.abs(northWest.y - southEast.y);
  const metersPerUnit = kind === "geographic" ? 111319.49079327358 : 1;
  const desiredUnitsPerPixel = Math.max(spanX / Math.max(1, viewportWidth), spanY / Math.max(1, viewportHeight), Number.EPSILON);
  const desiredMetersPerPixel = desiredUnitsPerPixel * metersPerUnit;
  const ordered = [...matrixSet.matrices].filter((matrix) => matrix.scaleDenominator > 0).sort((a, b) => b.scaleDenominator - a.scaleDenominator);
  if (!ordered.length) return [];
  let matrix = ordered.reduce((best, candidate) => {
    const bestError = Math.abs(Math.log((best.scaleDenominator * 0.00028) / desiredMetersPerPixel));
    const candidateError = Math.abs(Math.log((candidate.scaleDenominator * 0.00028) / desiredMetersPerPixel));
    return candidateError < bestError ? candidate : best;
  }, ordered[0]);

  const build = (selected: WmtsTileMatrix) => {
    const resolution = selected.scaleDenominator * 0.00028 / metersPerUnit;
    const tileSpanX = selected.tileWidth * resolution;
    const tileSpanY = selected.tileHeight * resolution;
    const [originX, originY] = selected.topLeftCorner;
    const minX = Math.min(northWest.x, southEast.x);
    const maxX = Math.max(northWest.x, southEast.x);
    const minY = Math.min(northWest.y, southEast.y);
    const maxY = Math.max(northWest.y, southEast.y);
    const minCol = Math.max(0, Math.floor((minX - originX) / tileSpanX));
    const maxCol = Math.min(selected.matrixWidth - 1, Math.floor((maxX - originX) / tileSpanX));
    const minRow = Math.max(0, Math.floor((originY - maxY) / tileSpanY));
    const maxRow = Math.min(selected.matrixHeight - 1, Math.floor((originY - minY) / tileSpanY));
    if (maxCol < minCol || maxRow < minRow) return [] as WmtsScreenTile[];
    const tiles: WmtsScreenTile[] = [];
    for (let row = minRow; row <= maxRow; row += 1) for (let col = minCol; col <= maxCol; col += 1) {
      const left = originX + col * tileSpanX;
      const right = left + tileSpanX;
      const top = originY - row * tileSpanY;
      const bottom = top - tileSpanY;
      const topLeftGeo = geoPoint(kind, left, top);
      const bottomRightGeo = geoPoint(kind, right, bottom);
      const a = projection.project(topLeftGeo.latitude, topLeftGeo.longitude);
      const b = projection.project(bottomRightGeo.latitude, bottomRightGeo.longitude);
      tiles.push({ tileMatrix: selected.identifier, tileRow: row, tileCol: col, screenX: Math.min(a.x, b.x), screenY: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
    }
    return tiles;
  };

  let tiles = build(matrix);
  let index = ordered.indexOf(matrix);
  while (tiles.length > maxTiles && index > 0) {
    index -= 1;
    matrix = ordered[index];
    tiles = build(matrix);
  }
  return tiles.length <= maxTiles ? tiles : [];
}
