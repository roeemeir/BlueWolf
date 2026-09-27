import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { siAdjacentAngles, siAdjacentSummary } = await vite.ssrLoadModule('/lib/si-adjacent-angles.ts');
const slots = (...angles) => angles.map((angleDeg, index) => ({ angleDeg, ring: ['inner', 'middle', 'outer'][index % 3] }));

test('SI three equally spaced vehicles display only two adjacent 120 degree gaps', () => {
  assert.deepEqual(siAdjacentSummary(slots(0, 120, 240)), [120, 120]);
  assert.deepEqual(siAdjacentSummary(slots(240, 0, 120)), [120, 120]);
});

test('SI 90 degrees between successive vehicles on different rings is 90,90, not all-pairs 90', () => {
  const gaps = siAdjacentAngles(slots(0, 90, 180));
  assert.deepEqual(gaps.map((gap) => gap.angle), [90, 90]);
  assert.deepEqual(gaps.map((gap) => [gap.first, gap.second]), [[0, 1], [1, 2]]);
});

test('same bearing on separate rings is an actual zero gap; cannot display fictitious 90 degrees', () => {
  assert.deepEqual(siAdjacentSummary(slots(0, 90, 90)), [90, 0]);
  assert.deepEqual(siAdjacentSummary(slots(30, 30, 30)), [0, 0]);
});

test('wrap-around adjacent representation excludes the largest empty arc', () => {
  assert.deepEqual(siAdjacentSummary(slots(300, 0, 60)), [60, 60]);
  assert.deepEqual(siAdjacentSummary(slots(60, 300, 0)), [60, 60]);
});

test('SI summary has no absolute bearings, handles empty and non-finite input without fictional coordinates', () => {
  assert.deepEqual(siAdjacentSummary(slots()), []);
  assert.deepEqual(siAdjacentSummary(slots(30)), []);
  assert.deepEqual(siAdjacentSummary(slots(30, Number.NaN)), []);
});
