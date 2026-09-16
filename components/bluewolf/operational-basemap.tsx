"use client";

import type { OperationalMapSource } from "@/lib/map-source-config";
import { webMercatorTiles, type OperationalProjection } from "@/lib/operational-map-projection";
import { defaultWmtsLayerSelections, wmtsScreenTiles } from "@/lib/wmts-capabilities";

const WIDTH = 1000;
const HEIGHT = 570;

function proxyUrl(sourceId: string, params: Record<string, string | number>) {
  const query = new URLSearchParams({ sourceId });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  return `/api/map-sources/proxy?${query.toString()}`;
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
  if (!source || !source.enabled || projection.empty) return null;
  if (source.kind === "wms") {
    const bounds = projection.viewGeoBounds;
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
    return <g className="v04-operational-basemap" data-map-source-kind="wmts" data-wmts-layer-count={visible.length}>
      {visible.map((selection) => {
        const matrixSet = source.wmtsCatalog?.tileMatrixSets.find((item) => item.identifier === selection.tileMatrixSet);
        if (!matrixSet) return null;
        const tiles = wmtsScreenTiles(projection, matrixSet, WIDTH, HEIGHT);
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

  const tiles = webMercatorTiles(projection, WIDTH, HEIGHT);
  return <g className="v04-operational-basemap" data-map-source-kind={source.kind}>{tiles.map((tile) => {
    const href = source.kind === "wmts"
      ? proxyUrl(source.id, { tileMatrix: tile.z, tileRow: tile.y, tileCol: tile.x })
      : proxyUrl(source.id, { z: tile.z, x: tile.x, y: tile.y });
    return <image key={`${tile.z}:${tile.x}:${tile.y}`} href={href} x={tile.screenX} y={tile.screenY} width={tile.width + 0.5} height={tile.height + 0.5} preserveAspectRatio="none"><title>{source.name} · {source.kind.toUpperCase()} · z{tile.z}/{tile.x}/${tile.y}</title></image>;
  })}</g>;
}
