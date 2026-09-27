import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const projection = await vite.ssrLoadModule('/lib/operational-map-projection.ts');

const rows = [
  { latitude: 32.0, longitude: 34.8 },
  { latitude: 32.002, longitude: 34.804 },
  { latitude: 31.998, longitude: 34.796 },
];

test('BW-OFF-010 WMS projection exposes exact geographic viewport bounds containing all evidence', () => {
  const view = projection.createOperationalProjection(rows, 1000, 570, 70, 65, 'local-wgs84');
  assert.equal(view.empty, false);
  assert.ok(view.viewGeoBounds.minLatitude < 31.998);
  assert.ok(view.viewGeoBounds.maxLatitude > 32.002);
  assert.ok(view.viewGeoBounds.minLongitude < 34.796);
  assert.ok(view.viewGeoBounds.maxLongitude > 34.804);
  for (const row of rows) {
    const point = view.project(row.latitude, row.longitude);
    assert.ok(point.x >= 70 && point.x <= 930);
    assert.ok(point.y >= 65 && point.y <= 505);
  }
});

test('BW-OFF-010 WebMercator projection round-trips WGS84 and yields bounded tile grid', () => {
  for (const row of rows) {
    const world = projection.geoToWebMercatorWorld(row.latitude, row.longitude);
    const restored = projection.webMercatorWorldToGeo(world);
    assert.ok(Math.abs(restored.latitude - row.latitude) < 1e-9);
    assert.ok(Math.abs(restored.longitude - row.longitude) < 1e-9);
  }
  const view = projection.createOperationalProjection(rows, 1000, 570, 70, 65, 'webmercator');
  const tiles = projection.webMercatorTiles(view, 1000, 570);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.length <= 64);
  assert.ok(tiles.every((tile) => tile.z >= 0 && tile.x >= 0 && tile.y >= 0 && tile.width > 0 && tile.height > 0));
});
