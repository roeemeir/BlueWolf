"use client";

import { DEFAULT_PUBLIC_WMTS_SOURCE_ID, telAvivDemoBounds } from "@/lib/default-map-profile";
import type { OperationalMapSource } from "@/lib/map-source-config";
import { createOperationalProjection, webMercatorTiles, type OperationalProjection } from "@/lib/operational-map-projection";
import { defaultWmtsLayerSelections, wmtsScreenTiles } from "@/lib/wmts-capabilities";

const WIDTH = 1000;
const HEIGHT = 570;

function proxyUrl(sourceId: string, params: Record<string, string | number>) {
  const query = new URLSearchParams({ sourceId });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  return `/api/map-sources/proxy?${query.toString()}`;
}

function effectiveProjection(source: OperationalMapSource, projection: OperationalProjection) {
  if (!projection.empty || source.id !== DEFAULT_PUBLIC_WMTS_SOURCE_ID) return projection;
  const bounds = telAvivDemoBounds();
  return createOperationalProjection([
    { latitude: bounds.minLatitude, longitude: bounds.minLongitude },
    { latitude: bounds.minLatitude, longitude: bounds.maxLongitude },
    { latitude: bounds.maxLatitude, longitude: bounds.minLongitude },
    { latitude: bounds.maxLatitude, longitude: bounds.maxLongitude },
  ], WIDTH, HEIGHT, 32, 32, "webmercator");
}

export function OperationalBasemap({
  source,
  projection,
  visibleWmtsLayers,
}: {
  source: OperationalMapSource | null;
  projection: OperationalProjection;
  visibleWmtsLayers?: readonly string[];
}) {
  if (!source || !source.enabled) return null;
  const mapProjection = effectiveProjection(source, projection);
  if (mapProjection.empty) return null;

  if (source.kind === "wms") {
    const bounds = mapProjection.viewGeoBounds;
    if (!bounds) return null;
    const href = proxyUrl(source.id, {
      bbox: `${bounds.minLongitude},${bounds.minLatitude},${bounds.maxLongitude},${bounds.maxLatitude}`,
      width: WIDTH,
      height: HEIGHT,
    });
    return <g className="v04-operational-basemap" data-map-source-kind="wms"><image href={href} x="0" y="0" width={WIDTH} height={HEIGHT} preserveAspectRatio="none" opacity="0.82"><title>{source.name} · WMS · {source.attribution}</title></image></g>;
  }

  if (source.kind === "wmts" && source.wmtsCatalog) {
    const selections = source.wmtsLayers ?? defaultWmtsLayerSelections(source.wmtsCatalog);
    const visible = visibleWmtsLayers
      ? selections.filter((selection) => visibleWmtsLayers.includes(selection.layer))
      : selections.filter((selection) => selection.enabled);
    return <g className="v04-operational-basemap" data-map-source-kind="wmts" data-wmts-layer-count={visible.length} data-empty-demo={projection.empty ? "tel-aviv" : undefined}>
      {visible.map((selection) => {
        const matrixSet = source.wmtsCatalog?.tileMatrixSets.find((item) => item.identifier === selection.tileMatrixSet);
        if (!matrixSet) return null;
        const tiles = wmtsScreenTiles(mapProjection, matrixSet, WIDTH, HEIGHT);
        return <g key={selection.layer} data-wmts-layer={selection.layer} opacity={selection.opacity}>{tiles.map((tile) => {
          const href = proxyUrl(source.id, {
            layer: selection.layer,
            tileMatrix: tile.tileMatrix,
            tileRow: tile.tileRow,
            tileCol: tile.tileCol,
          });
          return <image key={`${selection.layer}:${tile.tileMatrix}:${tile.tileCol}:${tile.tileRow}`} href={href} x={tile.screenX} y={tile.screenY} width={tile.width + 0.5} height={tile.height + 0.5} preserveAspectRatio="none"><title>{source.name} · {selection.layer} · {tile.tileMatrix}/{tile.tileCol}/{tile.tileRow}</title></image>;
        })}</g>;
      })}
    </g>;
  }

  const tiles = webMercatorTiles(mapProjection, WIDTH, HEIGHT);
  return <g className="v04-operational-basemap" data-map-source-kind={source.kind}>{tiles.map((tile) => {
    const href = source.kind === "wmts"
      ? proxyUrl(source.id, { tileMatrix: tile.z, tileRow: tile.y, tileCol: tile.x })
      : proxyUrl(source.id, { z: tile.z, x: tile.x, y: tile.y });
    return <image key={`${tile.z}:${tile.x}:${tile.y}`} href={href} x={tile.screenX} y={tile.screenY} width={tile.width + 0.5} height={tile.height + 0.5} preserveAspectRatio="none"><title>{source.name} · {source.kind.toUpperCase()} · z{tile.z}/{tile.x}/${tile.y}</title></image>;
  })}</g>;
}
