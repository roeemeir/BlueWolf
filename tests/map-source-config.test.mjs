import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const maps = await vite.ssrLoadModule('/lib/map-source-config.ts');

test('BW-OFF-010 normalizes legacy XYZ and rejects plaintext workspace credentials', () => {
  const [legacy] = maps.normalizeMapSources([{ id: 'legacy', name: 'legacy', urlTemplate: 'https://maps.internal/{z}/{x}/{y}.png', attribution: '', enabled: true, isDefault: true }]);
  assert.equal(legacy.kind, 'xyz');
  assert.equal(legacy.tokenMode, 'none');
  assert.match(maps.buildXyzUpstreamUrl(legacy, 5, 10, 11).toString(), /\/5\/10\/11\.png$/);
  assert.throws(() => maps.normalizeMapSources([{ ...legacy, token: 'secret' }]), /must not store plaintext credentials/);
  assert.throws(() => maps.normalizeMapSources([{ ...legacy, baseUrl: 'https://user:pass@maps.internal/tiles' }]), /must not embed credentials/);
});

test('BW-OFF-010 builds truth-preserving WMS GetMap request and query token upstream only', () => {
  const source = maps.normalizeMapSource({
    id: 'wms-private', name: 'WMS', kind: 'wms', baseUrl: 'https://gis.internal/wms', layer: 'bluewolf',
    attribution: 'GIS', enabled: true, isDefault: true, crs: 'CRS:84', tokenMode: 'query', tokenQueryParam: 'access_token',
  });
  const url = maps.buildWmsUpstreamUrl(source, { bbox: [34.7, 31.9, 34.9, 32.1], width: 1000, height: 570 });
  assert.equal(url.searchParams.get('SERVICE'), 'WMS');
  assert.equal(url.searchParams.get('REQUEST'), 'GetMap');
  assert.equal(url.searchParams.get('LAYERS'), 'bluewolf');
  assert.equal(url.searchParams.get('CRS'), 'CRS:84');
  assert.equal(url.searchParams.get('BBOX'), '34.7,31.9,34.9,32.1');
  assert.equal(url.searchParams.has('access_token'), false);
  const secured = maps.applyMapSourceToken(url, source, 'secret-query-token');
  assert.equal(secured.url.searchParams.get('access_token'), 'secret-query-token');
  assert.equal(secured.headers.has('authorization'), false);
});

test('BW-OFF-010 builds WMTS GetTile and bearer token is carried only in upstream header', () => {
  const source = maps.normalizeMapSource({
    id: 'wmts-private', name: 'WMTS', kind: 'wmts', baseUrl: 'https://gis.internal/wmts', layer: 'ortho', tileMatrixSet: 'WebMercatorQuad',
    attribution: 'GIS', enabled: true, isDefault: false, tokenMode: 'bearer',
  });
  const url = maps.buildWmtsUpstreamUrl(source, { tileMatrix: '12', tileRow: 1600, tileCol: 2500 });
  assert.equal(url.searchParams.get('SERVICE'), 'WMTS');
  assert.equal(url.searchParams.get('REQUEST'), 'GetTile');
  assert.equal(url.searchParams.get('TILEMATRIXSET'), 'WebMercatorQuad');
  assert.equal(url.searchParams.get('TILEMATRIX'), '12');
  const secured = maps.applyMapSourceToken(url, source, 'secret-bearer-token');
  assert.equal(secured.headers.get('authorization'), 'Bearer secret-bearer-token');
  assert.doesNotMatch(secured.url.toString(), /secret-bearer-token/);
});

test('BW-OFF-010 path-token WMTS keeps key out of workspace/catalog and injects it upstream only', () => {
  const placeholder = maps.DEFAULT_MAP_TOKEN_PATH_PLACEHOLDER;
  const source = maps.normalizeMapSource({
    id: 'wmts-path', name: 'WMTS path', kind: 'wmts',
    baseUrl: `https://maps.example/v2/${placeholder}/WMTSCapabilities.xml`,
    layer: 'osm', tileMatrixSet: 'webmercator', attribution: '', enabled: true, isDefault: true,
    tokenMode: 'path', tokenPathPlaceholder: placeholder,
  });
  assert.match(source.baseUrl, new RegExp(placeholder));
  assert.doesNotMatch(source.baseUrl, /secret-path-key/);

  const securedCapabilities = maps.applyMapSourceToken(new URL(source.baseUrl), source, 'secret-path-key');
  assert.match(securedCapabilities.url.pathname, /\/v2\/secret-path-key\/WMTSCapabilities\.xml$/);
  assert.doesNotMatch(source.baseUrl, /secret-path-key/);

  const discovered = {
    version: '1.0.0',
    getTileKvpUrls: ['https://maps.example/v2/secret-path-key/wmts'],
    layers: [{
      identifier: 'osm', styles: [{ identifier: 'default', isDefault: true }], formats: ['image/png'], tileMatrixSets: ['webmercator'],
      resourceUrls: [{ format: 'image/png', resourceType: 'tile', template: 'https://maps.example/v2/secret-path-key/osm/{TileMatrix}/{TileCol}/{TileRow}.png' }],
    }],
    tileMatrixSets: [{ identifier: 'webmercator', supportedCrs: 'EPSG:3857', matrices: [] }],
  };
  const safeCatalog = maps.sanitizeWmtsCatalogToken(discovered, source, 'secret-path-key');
  assert.doesNotMatch(JSON.stringify(safeCatalog), /secret-path-key/);
  assert.match(JSON.stringify(safeCatalog), new RegExp(placeholder));

  const tile = maps.buildWmtsUpstreamUrl({ ...source, wmtsCatalog: safeCatalog, wmtsLayers: [{ layer: 'osm', style: 'default', format: 'image/png', tileMatrixSet: 'webmercator', enabled: true, order: 0, opacity: 1 }] }, {
    tileMatrix: '13', tileRow: 3324, tileCol: 4887,
    layer: 'osm', style: 'default', format: 'image/png', tileMatrixSet: 'webmercator',
    resourceTemplate: safeCatalog.layers[0].resourceUrls[0].template,
  });
  assert.match(tile.pathname, new RegExp(placeholder));
  assert.doesNotMatch(tile.toString(), /secret-path-key/);
  const securedTile = maps.applyMapSourceToken(tile, source, 'secret-path-key');
  assert.match(securedTile.url.pathname, /\/v2\/secret-path-key\/osm\/13\/4887\/3324\.png$/);
});
