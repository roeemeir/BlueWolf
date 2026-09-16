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
