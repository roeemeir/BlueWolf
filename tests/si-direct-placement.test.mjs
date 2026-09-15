import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const {
  placeSiVehicle,
  deriveSiPairRules,
  validateSiPositions,
} = await vite.ssrLoadModule('/lib/si-direct-placement.ts');
const { canonicalTemplateKey } = await vite.ssrLoadModule('/lib/bluewolf.ts');

const vehicleTypes = [
  { id: 'inner', name: 'Inner', minId: 1, maxId: 9, workSpeedKmh: 40, siRoles: ['inner'], icon: 'rover', color: '#111' },
  { id: 'middle', name: 'Middle', minId: 10, maxId: 19, workSpeedKmh: 50, siRoles: ['middle'], icon: 'truck', color: '#222' },
  { id: 'outer', name: 'Outer', minId: 20, maxId: 29, workSpeedKmh: 60, siRoles: ['outer'], icon: 'shield', color: '#333' },
];

test('SI direct placement enforces ring law, 30 degree resolution and occupied slots', () => {
  let positions = [];
  let result = placeSiVehicle(positions, vehicleTypes[0], 'inner', 0);
  assert.equal(result.ok, true);
  positions = result.positions;

  result = placeSiVehicle(positions, vehicleTypes[1], 'inner', 30);
  assert.deepEqual(result, { ok: false, reason: 'ring-not-allowed' });
  result = placeSiVehicle(positions, vehicleTypes[1], 'middle', 25);
  assert.deepEqual(result, { ok: false, reason: 'invalid-angle' });
  result = placeSiVehicle(positions, vehicleTypes[0], 'inner', 0);
  assert.deepEqual(result, { ok: false, reason: 'slot-occupied' });
});

test('SI pair angles are derived from positions rather than entered independently', () => {
  const positions = [
    { typeId: 'inner', ring: 'inner', angleDeg: 0 },
    { typeId: 'middle', ring: 'middle', angleDeg: 120 },
    { typeId: 'outer', ring: 'outer', angleDeg: 240 },
  ];
  assert.deepEqual(deriveSiPairRules(positions), [
    { first: 0, second: 1, angle: 120 },
    { first: 0, second: 2, angle: 240 },
    { first: 1, second: 2, angle: 120 },
  ]);
  assert.equal(validateSiPositions(positions, vehicleTypes), null);
});

test('SI validation rejects too few vehicles and a type placed on a forbidden ring', () => {
  assert.match(validateSiPositions([{ typeId: 'inner', ring: 'inner', angleDeg: 0 }], vehicleTypes), /2–5/);
  assert.match(validateSiPositions([
    { typeId: 'inner', ring: 'outer', angleDeg: 0 },
    { typeId: 'outer', ring: 'outer', angleDeg: 120 },
  ], vehicleTypes), /אינו מורשה/);
});

test('SI canonical identity preserves common rotation and reflection equivalence from siPositions', () => {
  const make = (positions) => ({ family: 'SI', mix: 'same', constellation: 'same', values: [], siPositions: positions });
  const base = make([
    { typeId: 'inner', ring: 'inner', angleDeg: 0 },
    { typeId: 'middle', ring: 'middle', angleDeg: 120 },
    { typeId: 'outer', ring: 'outer', angleDeg: 240 },
  ]);
  const rotated = make([
    { typeId: 'inner', ring: 'inner', angleDeg: 30 },
    { typeId: 'middle', ring: 'middle', angleDeg: 150 },
    { typeId: 'outer', ring: 'outer', angleDeg: 270 },
  ]);
  const reflected = make([
    { typeId: 'inner', ring: 'inner', angleDeg: 0 },
    { typeId: 'middle', ring: 'middle', angleDeg: 240 },
    { typeId: 'outer', ring: 'outer', angleDeg: 120 },
  ]);
  assert.equal(canonicalTemplateKey(base), canonicalTemplateKey(rotated));
  assert.equal(canonicalTemplateKey(base), canonicalTemplateKey(reflected));
});
