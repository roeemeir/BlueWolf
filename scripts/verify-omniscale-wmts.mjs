import assert from 'node:assert/strict';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({
  appType: 'custom',
  configFile: false,
  root,
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true, hmr: false },
});

const DEMO_TOKEN = process.env.BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN?.trim() || 'demo';
const TEL_AVIV = [
  { latitude: 32.0503, longitude: 34.7268 },
  { latitude: 32.0503, longitude: 34.8368 },
  { latitude: 32.1203, longitude: 34.7268 },
  { latitude: 32.1203, longitude: 34.8368 },
];

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`WMTS upstream returned HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

try {
  const wmts = await vite.ssrLoadModule('/lib/wmts-capabilities.ts');
  const maps = await vite.ssrLoadModule('/lib/map-source-config.ts');
  const profile = await vite.ssrLoadModule('/lib/default-map-profile.ts');
  const projection = await vite.ssrLoadModule('/lib/operational-map-projection.ts');

  const sourceWithoutCatalog = maps.normalizeMapSource(profile.DEFAULT_PUBLIC_WMTS_SOURCE);
  assert.equal(sourceWithoutCatalog.tokenMode, 'path');
  assert.match(sourceWithoutCatalog.baseUrl, new RegExp(maps.DEFAULT_MAP_TOKEN_PATH_PLACEHOLDER));
  assert.doesNotMatch(sourceWithoutCatalog.baseUrl, new RegExp(`/${DEMO_TOKEN}/`, 'i'));

  const capabilitiesUpstream = maps.applyMapSourceToken(new URL(sourceWithoutCatalog.baseUrl), sourceWithoutCatalog, DEMO_TOKEN);
  const capabilitiesResponse = await fetchWithRetry(capabilitiesUpstream.url, {
    headers: { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1' },
    redirect: 'error',
  });
  const xml = await capabilitiesResponse.text();
  assert.match(xml, /Capabilities/i);

  const discoveredCatalog = wmts.parseWmtsCapabilities(xml);
  const catalog = maps.sanitizeWmtsCatalogToken(discoveredCatalog, sourceWithoutCatalog, DEMO_TOKEN);
  assert.doesNotMatch(JSON.stringify(catalog), new RegExp(`/${DEMO_TOKEN}/`, 'i'));
  assert.match(JSON.stringify(catalog), new RegExp(maps.DEFAULT_MAP_TOKEN_PATH_PLACEHOLDER));

  const selections = wmts.defaultWmtsLayerSelections(catalog);
  assert.ok(selections.length > 0, 'Omniscale must expose at least one compatible WMTS layer');
  const selection = selections.find((item) => item.layer === 'osm') ?? selections[0];
  const matrixSet = catalog.tileMatrixSets.find((item) => item.identifier === selection.tileMatrixSet);
  assert.ok(matrixSet, `missing TileMatrixSet ${selection.tileMatrixSet}`);
  assert.equal(wmts.wmtsProjectionKind(matrixSet.supportedCrs), 'webmercator');

  const mapProjection = projection.createOperationalProjection(TEL_AVIV, 1000, 570, 32, 32, 'webmercator');
  const tiles = wmts.wmtsScreenTiles(mapProjection, matrixSet, 1000, 570);
  assert.ok(tiles.length > 0, 'Tel Aviv viewport must resolve to at least one WMTS tile');
  const tile = tiles.reduce((best, candidate) => {
    const cx = candidate.screenX + candidate.width / 2;
    const cy = candidate.screenY + candidate.height / 2;
    const score = Math.hypot(cx - 500, cy - 285);
    return score < best.score ? { tile: candidate, score } : best;
  }, { tile: tiles[0], score: Number.POSITIVE_INFINITY }).tile;

  const source = maps.normalizeMapSource({
    ...sourceWithoutCatalog,
    wmtsCatalog: catalog,
    wmtsLayers: selections,
    layer: undefined,
    tileMatrixSet: undefined,
  });
  const resolved = maps.resolveWmtsLayer(source, selection.layer);
  const safeTileUrl = maps.buildWmtsUpstreamUrl(source, {
    layer: resolved.layer,
    style: resolved.style,
    format: resolved.format,
    tileMatrixSet: resolved.tileMatrixSet,
    tileMatrix: tile.tileMatrix,
    tileRow: tile.tileRow,
    tileCol: tile.tileCol,
    resourceTemplate: resolved.resourceTemplate,
    kvpUrl: resolved.kvpUrl,
  });
  assert.doesNotMatch(safeTileUrl.toString(), new RegExp(`/${DEMO_TOKEN}/`, 'i'));
  assert.match(safeTileUrl.toString(), new RegExp(maps.DEFAULT_MAP_TOKEN_PATH_PLACEHOLDER));

  const tileUpstream = maps.applyMapSourceToken(safeTileUrl, source, DEMO_TOKEN);
  const tileResponse = await fetchWithRetry(tileUpstream.url, { redirect: 'error' });
  const contentType = tileResponse.headers.get('content-type') ?? '';
  assert.match(contentType, /^image\//i, `expected image tile, got ${contentType}`);
  const bytes = new Uint8Array(await tileResponse.arrayBuffer());
  assert.ok(bytes.byteLength > 1_000, `tile payload unexpectedly small: ${bytes.byteLength}`);

  console.log(JSON.stringify({
    ok: true,
    tokenMode: source.tokenMode,
    capabilitiesProfile: source.baseUrl,
    serviceTitle: catalog.serviceTitle,
    layer: selection.layer,
    matrixSet: selection.tileMatrixSet,
    tile: `${tile.tileMatrix}/${tile.tileCol}/${tile.tileRow}`,
    tileBytes: bytes.byteLength,
    viewport: 'Tel Aviv, Israel',
    credentialExposure: false,
  }, null, 2));
} finally {
  await vite.close();
}
