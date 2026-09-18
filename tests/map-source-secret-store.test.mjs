import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bluewolf-map-secret-'));
const dbPath = path.join(tempDir, 'bluewolf.sqlite');
const previous = {
  storage: process.env.BLUEWOLF_STORAGE,
  sqlite: process.env.BLUEWOLF_SQLITE_PATH,
  demo: process.env.BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN,
};
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = dbPath;
process.env.BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN = 'demo-test-secret';

const capabilities = `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.0.0">
  <ows:ServiceIdentification><ows:Title>Omniscale Test</ows:Title></ows:ServiceIdentification>
  <ows:OperationsMetadata>
    <ows:Operation name="GetTile"><ows:DCP><ows:HTTP><ows:Get xlink:href="https://maps.omniscale.net/v2/demo-test-secret/wmts"/></ows:HTTP></ows:DCP></ows:Operation>
  </ows:OperationsMetadata>
  <Contents>
    <Layer>
      <ows:Title>OSM</ows:Title><ows:Identifier>osm</ows:Identifier>
      <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>EPSG:3857</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL format="image/png" resourceType="tile" template="https://maps.omniscale.net/v2/demo-test-secret/style.default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>EPSG:3857</ows:Identifier>
      <ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>
      <TileMatrix>
        <ows:Identifier>0</ows:Identifier>
        <ScaleDenominator>559082264.0287178</ScaleDenominator>
        <TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner>
        <TileWidth>256</TileWidth><TileHeight>256</TileHeight>
        <MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight>
      </TileMatrix>
    </TileMatrixSet>
  </Contents>
</Capabilities>`;

const originalFetch = globalThis.fetch;
let discoveryCalls = 0;
globalThis.fetch = async (input) => {
  const url = String(input);
  discoveryCalls += 1;
  assert.match(url, /\/v2\/demo-test-secret\/WMTSCapabilities\.xml$/);
  return new Response(capabilities, { status: 200, headers: { 'content-type': 'application/xml' } });
};

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  root,
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(previous)) {
    const envKey = key === 'storage' ? 'BLUEWOLF_STORAGE'
      : key === 'sqlite' ? 'BLUEWOLF_SQLITE_PATH'
      : 'BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN';
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  }
  await rm(tempDir, { recursive: true, force: true });
});

test('BW-OFF-010 new installation shares sanitized discovery with proxy and stores key only in SQLite secret storage', async () => {
  const profile = await vite.ssrLoadModule('/lib/default-map-profile.ts');
  const maps = await vite.ssrLoadModule('/lib/map-source-config.ts');
  const sqlite = await vite.ssrLoadModule('/lib/sqlite-workspace.ts');
  const local = await vite.ssrLoadModule('/lib/local-map-source-server.ts');

  const state = profile.ensureTelAvivDemoMapState({ mapServers: [], settings: {} });
  const serialized = JSON.stringify(state);
  assert.match(serialized, /__BLUEWOLF_MAP_TOKEN__/);
  assert.doesNotMatch(serialized, /demo-test-secret/);

  const saved = await sqlite.writeLocalWorkspace(
    local.LOCAL_WORKSPACE_ID,
    serialized,
    'map-source',
    'seed-default-wmts',
    'test fixture',
    0,
  );
  assert.equal(saved.ok, true);

  const source = await local.localMapSource(profile.DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  assert.equal(source.tokenMode, 'path');
  assert.ok(source.wmtsCatalog, 'proxy source must receive discovered catalog before any user save');
  assert.equal(discoveryCalls, 1);

  const resolved = maps.resolveWmtsLayer(source, 'osm');
  assert.match(resolved.resourceTemplate, /__BLUEWOLF_MAP_TOKEN__/);
  assert.doesNotMatch(resolved.resourceTemplate, /demo-test-secret/);

  // Successful discovery is cached in-process; tile/proxy lookups do not refetch
  // GetCapabilities for every tile.
  const sourceAgain = await local.localMapSource(profile.DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  assert.ok(sourceAgain.wmtsCatalog);
  assert.equal(discoveryCalls, 1);

  assert.equal(await sqlite.hasLocalMapSourceToken(local.LOCAL_WORKSPACE_ID, source.id), false);
  const token = await local.localMapSourceSecret(source);
  assert.equal(token, 'demo-test-secret');
  assert.equal(await sqlite.hasLocalMapSourceToken(local.LOCAL_WORKSPACE_ID, source.id), true);

  const safeTileUrl = maps.buildWmtsUpstreamUrl(source, {
    ...resolved,
    tileMatrix: '0',
    tileRow: 0,
    tileCol: 0,
  });
  assert.match(safeTileUrl.toString(), /__BLUEWOLF_MAP_TOKEN__/);
  const upstreamTile = maps.applyMapSourceToken(safeTileUrl, source, token);
  assert.match(upstreamTile.url.toString(), /demo-test-secret/);

  const persisted = await sqlite.readLocalWorkspace(local.LOCAL_WORKSPACE_ID);
  const persistedJson = JSON.stringify(persisted.state);
  assert.match(persistedJson, /__BLUEWOLF_MAP_TOKEN__/);
  assert.doesNotMatch(persistedJson, /demo-test-secret/);
});
