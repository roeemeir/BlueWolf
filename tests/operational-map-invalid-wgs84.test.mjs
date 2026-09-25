import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const map = await vite.ssrLoadModule('/lib/operational-map-projection.ts');

const known = [
  { latitude: 32.05, longitude: 34.77 },
  { latitude: 32.06, longitude: 34.79 },
];
const impossible = [
  { latitude: 95, longitude: 34.8 },
  { latitude: 32.05, longitude: 181 },
  { latitude: Number.NaN, longitude: 34.8 },
  { latitude: 32.05, longitude: Number.POSITIVE_INFINITY },
];

test('OP-02 operational map rejects impossible WGS84 fixes instead of distorting auto-fit', () => {
  for (const mode of ['local-wgs84', 'webmercator']) {
    const baseline = map.createOperationalProjection(known, 1000, 570, 70, 65, mode);
    const withNoise = map.createOperationalProjection([...impossible, ...known], 1000, 570, 70, 65, mode);
    assert.deepEqual(withNoise.viewGeoBounds, baseline.viewGeoBounds);
    for (const point of known) assert.deepEqual(withNoise.project(point.latitude, point.longitude), baseline.project(point.latitude, point.longitude));
    for (const point of impossible) {
      const rendered = withNoise.project(point.latitude, point.longitude);
      assert.ok(Number.isNaN(rendered.x) && Number.isNaN(rendered.y), 'invalid navigation must not be given a plausible screen location');
    }
  }
});

test('OP-02 malformed-only input leaves a finite QA basemap viewport, not a NaN projection', () => {
  const projection = map.createOperationalProjection(impossible, 1000, 570, 70, 65, 'webmercator');
  assert.ok(Number.isFinite(projection.viewGeoBounds.minLatitude));
  assert.ok(Number.isFinite(projection.viewGeoBounds.maxLongitude));
  assert.ok(Number.isFinite(projection.project(32.05, 34.77).x));
  assert.equal(map.validOperationalGeoPoint({ latitude: -90, longitude: 180 }), true);
  assert.equal(map.validOperationalGeoPoint({ latitude: -90.001, longitude: 180 }), false);
});
