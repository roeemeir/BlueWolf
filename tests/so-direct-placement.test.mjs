import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const {
  canonicalSoOrderKey,
  generateUniqueSoOrders,
  soSmilePoses,
  soPhasesForRoute,
  placeSoVehicle,
  toggleSoVehicleDirection,
  deriveSoRelations,
  validateSoPlacements,
} = await vite.ssrLoadModule('/lib/so-direct-placement.ts');

test('SO-01 generates every multiset order once modulo reversal only', () => {
  const orders = generateUniqueSoOrders(2, 2);
  const keys = orders.map(canonicalSoOrderKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(orders.length, 4);
  assert.ok(orders.some((order) => order.join(',') === 'single,single,double,double'));
  assert.ok(orders.some((order) => order.join(',') === 'single,double,single,double'));
  assert.ok(orders.some((order) => order.join(',') === 'single,double,double,single'));
  assert.ok(orders.some((order) => order.join(',') === 'double,single,single,double'));
});

test('SO smile geometry uses 30 degree neighbor spacing and symmetric even layout', () => {
  const odd = soSmilePoses(3);
  assert.deepEqual(odd.map((item) => item.rotationDeg), [-30, 0, 30]);
  const even = soSmilePoses(4);
  assert.deepEqual(even.map((item) => item.rotationDeg), [-45, -15, 15, 45]);
  assert.equal(even[0].offsetX, -even[3].offsetX);
  assert.equal(even[1].offsetX, -even[2].offsetX);
  assert.equal(even[0].offsetY, even[3].offsetY);
});

test('SO-02 exposes half slots for single and quarter slots for double', () => {
  assert.deepEqual([...soPhasesForRoute('single')], [0, 0.5]);
  assert.deepEqual([...soPhasesForRoute('double')], [0, 0.25, 0.5, 0.75]);
});

test('SO placement is independent of vehicle type and clicking existing vehicle can reverse direction', () => {
  const chain = ['single', 'double'];
  const first = placeSoVehicle([], chain, 0, 0.5, 'storm');
  assert.equal(first.ok, true);
  const second = placeSoVehicle(first.placements, chain, 1, 0.25, 'lightning');
  assert.equal(second.ok, true);
  const invalid = placeSoVehicle(second.placements, chain, 0, 0.25, 'thunder');
  assert.deepEqual(invalid, { ok: false, reason: 'invalid-phase' });
  const reversed = toggleSoVehicleDirection(second.placements, 1, 0.25);
  assert.equal(reversed.find((item) => item.routeIndex === 1)?.direction, 'reverse');
  assert.equal(validateSoPlacements(chain, reversed), null);
});

test('SO relations are derived from semantic quarter placement and direction', () => {
  const chain = ['double', 'double', 'double'];
  const placements = [
    { routeIndex: 0, phase: 0, typeId: 'storm', direction: 'forward' },
    { routeIndex: 1, phase: 0, typeId: 'lightning', direction: 'forward' },
    { routeIndex: 2, phase: 0.5, typeId: 'thunder', direction: 'forward' },
  ];
  assert.deepEqual(deriveSoRelations(chain, placements), ['same', 'opposite']);
  const mixed = [...placements, { routeIndex: 1, phase: 0.25, typeId: 'storm', direction: 'forward' }];
  assert.equal(deriveSoRelations(chain, mixed)[0], 'mixed');
});
