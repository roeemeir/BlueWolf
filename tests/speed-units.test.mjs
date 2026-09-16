import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const speed = await vite.ssrLoadModule('/lib/speed-units.ts');

test('OP-03 uses the exact nautical-mile conversion', () => {
  assert.equal(speed.METERS_PER_NAUTICAL_MILE, 1852);
  assert.equal(speed.SECONDS_PER_HOUR, 3600);
  assert.equal(speed.KILOMETERS_PER_NAUTICAL_MILE, 1.852);
  assert.equal(speed.metersPerSecondToKnots(1852 / 3600), 1);
  assert.equal(speed.kilometersPerHourToKnots(1.852), 1);
  assert.equal(speed.formatKnotsFromMps(5), '9.7 קשר');
  assert.equal(speed.formatKnotsFromKmh(45), '24.3 קשר');
});

test('OP-03 rejects missing/invalid speed instead of inventing a displayed value', () => {
  assert.throws(() => speed.metersPerSecondToKnots(Number.NaN), /finite non-negative/);
  assert.throws(() => speed.metersPerSecondToKnots(-1), /finite non-negative/);
  assert.throws(() => speed.kilometersPerHourToKnots(Infinity), /finite non-negative/);
});
