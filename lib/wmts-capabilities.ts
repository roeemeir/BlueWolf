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

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

function localName(name: string) {
  return name.split(":").at(-1) ?? name;
}

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parseAttributes(raw: string) {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of raw.matchAll(re)) attrs[localName(match[1])] = decodeXml(match[3]);
  return attrs;
}

function parseXml(xml: string): XmlNode {
  if (/<!DOCTYPE/i.test(xml)) throw new Error("WMTS Capabilities DOCTYPE is not accepted");
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  const tokens = xml.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<?") || token.startsWith("<!--")) continue;
    if (token.startsWith("<![CDATA[")) {
      stack.at(-1)!.text += token.slice(9, -3);
      continue;
    }
    if (token.startsWith("</")) {
      const closing = localName(token.slice(2, -1).trim());
      if (stack.length === 1 || stack.at(-1)!.name !== closing) throw new Error(`WMTS XML closing tag mismatch: ${closing}`);
      stack.pop();
      continue;
    }
    if (token.startsWith("<")) {
      const selfClosing = /\/\s*>$/.test(token);
      const inner = token.slice(1, selfClosing ? token.lastIndexOf("/") : -1).trim();
      const space = inner.search(/\s/);
      const rawName = space < 0 ? inner : inner.slice(0, space);
      const node: XmlNode = {
        name: localName(rawName),
        attrs: parseAttributes(space < 0 ? "" : inner.slice(space + 1)),
        children: [],
        text: "",
      };
      stack.at(-1)!.children.push(node);
      if (!selfClosing) stack.push(node);
      continue;
    }
    stack.at(-1)!.text += token;
  }
  if (stack.length !== 1) throw new Error("WMTS XML is not balanced");
  const documentRoot = root.children.find((node) => node.name === "Capabilities");
  if (!documentRoot) throw new Error("response is not a WMTS Capabilities document");
  return documentRoot;
}

function child(node: XmlNode, name: string) {
  return node.children.find((item) => item.name === name);
}

function children(node: XmlNode, name: string) {
  return node.children.filter((item) => item.name === name);
}

function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((item) => [...(item.name === name ? [item] : []), ...descendants(item, name)]);
}

function nodeText(node: XmlNode | undefined) {
  if (!node) return undefined;
  const value = decodeXml(`${node.text} ${node.children.map((item) => nodeText(item) ?? "").join(" ")}`.replace(/\s+/g, " ").trim());
  return value || undefined;
}

function requiredText(node: XmlNode | undefined, label: string) {
  const value = nodeText(node);
  if (!value) throw new Error(`WMTS ${label} is missing`);
  return value;
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
  const root = parseXml(xml);
  const contents = child(root, "Contents");
  if (!contents) throw new Error("WMTS Capabilities does not contain Contents");

  const layers: WmtsLayer[] = children(contents, "Layer").map((layerNode) => {
    const identifier = requiredText(child(layerNode, "Identifier"), "layer Identifier");
    const styles = children(layerNode, "Style").map((styleNode) => ({
      identifier: nodeText(child(styleNode, "Identifier")) ?? "default",
      title: nodeText(child(styleNode, "Title")),
      isDefault: /^true$|^1$/i.test(styleNode.attrs.isDefault ?? ""),
    }));
    const tileMatrixSets = children(layerNode, "TileMatrixSetLink")
      .map((link) => nodeText(child(link, "TileMatrixSet")))
      .filter((value): value is string => Boolean(value));
    const resourceUrls = children(layerNode, "ResourceURL").flatMap((resourceNode) => {
      const template = resourceNode.attrs.template;
      if (!template) return [];
      return [{ format: resourceNode.attrs.format, resourceType: resourceNode.attrs.resourceType, template }];
    });
    return {
      identifier,
      title: nodeText(child(layerNode, "Title")),
      styles: styles.length ? styles : [{ identifier: "default", isDefault: true }],
      formats: unique(children(layerNode, "Format").map((item) => nodeText(item) ?? "")),
      tileMatrixSets: unique(tileMatrixSets),
      resourceUrls,
    };
  });

  const tileMatrixSets: WmtsTileMatrixSet[] = children(contents, "TileMatrixSet").map((setNode) => {
    const identifier = requiredText(child(setNode, "Identifier"), "TileMatrixSet Identifier");
    const supportedCrs = requiredText(child(setNode, "SupportedCRS"), `TileMatrixSet ${identifier} SupportedCRS`);
    const matrices = children(setNode, "TileMatrix").map((matrixNode) => ({
      identifier: requiredText(child(matrixNode, "Identifier"), `TileMatrixSet ${identifier} matrix Identifier`),
      scaleDenominator: finiteNumber(nodeText(child(matrixNode, "ScaleDenominator")), "ScaleDenominator"),
      topLeftCorner: parseTopLeft(nodeText(child(matrixNode, "TopLeftCorner"))),
      tileWidth: positiveInteger(nodeText(child(matrixNode, "TileWidth")), "TileWidth"),
      tileHeight: positiveInteger(nodeText(child(matrixNode, "TileHeight")), "TileHeight"),
      matrixWidth: positiveInteger(nodeText(child(matrixNode, "MatrixWidth")), "MatrixWidth"),
      matrixHeight: positiveInteger(nodeText(child(matrixNode, "MatrixHeight")), "MatrixHeight"),
    }));
    if (!matrices.length) throw new Error(`WMTS TileMatrixSet ${identifier} contains no TileMatrix definitions`);
    return {
      identifier,
      title: nodeText(child(setNode, "Title")),
      supportedCrs,
      wellKnownScaleSet: nodeText(child(setNode, "WellKnownScaleSet")),
      matrices,
    };
  });

  const getTileKvpUrls = descendants(root, "Operation")
    .filter((operation) => (operation.attrs.name ?? "").toLowerCase() === "gettile")
    .flatMap((operation) => descendants(operation, "Get").map((getNode) => getNode.attrs.href).filter((value): value is string => Boolean(value)));

  if (!layers.length) throw new Error("WMTS Capabilities contains no layers");
  if (!tileMatrixSets.length) throw new Error("WMTS Capabilities contains no TileMatrixSets");
  return {
    version: root.attrs.version ?? "1.0.0",
    serviceTitle: nodeText(child(child(root, "ServiceIdentification") ?? root, "Title")),
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
  catalog.layers.forEach((layer) => {
    const matrixSet = compatibleMatrixSets(catalog, layer)[0];
    if (!matrixSet) return;
    const style = layer.styles.find((item) => item.isDefault)?.identifier ?? layer.styles[0]?.identifier ?? "default";
    rows.push({
      layer: layer.identifier,
      style,
      format: layer.formats.find((item) => item.toLowerCase().startsWith("image/")) ?? layer.formats[0] ?? "image/png",
      tileMatrixSet: matrixSet.identifier,
      enabled: rows.length === 0,
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
  const y = 6378137 * Math.log(Math.tan(Math.PI / 4 + clamped * Math.PI / 360));
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
