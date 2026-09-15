import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => vite.close());
const ranges = await vite.ssrLoadModule('/lib/vehicle-id-ranges.ts');

const vehicleTypes = [
  { id: 'storm', name: 'Storm', minId: 1, maxId: 99, workSpeedKmh: 55, siRoles: ['outer'], icon: 'rover', color: '#000' },
  { id: 'lightning', name: 'Lightning', minId: 100, maxId: 199, workSpeedKmh: 72, siRoles: ['inner'], icon: 'truck', color: '#000' },
];

test('vehicle number resolves to exactly one configured type and work speed', () => {
  assert.deepEqual(ranges.resolveVehicleProfile(120, vehicleTypes), { typeId: 'lightning', typeName: 'Lightning', workSpeedKmh: 72 });
  assert.deepEqual(ranges.resolveVehicleProfile(10, vehicleTypes), { typeId: 'storm', typeName: 'Storm', workSpeedKmh: 55 });
  assert.equal(ranges.resolveVehicleProfile(500, vehicleTypes), null);
});

test('overlap is rejected instead of relying on array order', () => {
  assert.throws(() => ranges.validateVehicleIdRanges([
    ...vehicleTypes,
    { ...vehicleTypes[1], id: 'bad', name: 'Bad', minId: 90, maxId: 120 },
  ]), /חופפים/);
});

test('non-positive work speed and illegal ranges are rejected', () => {
  assert.throws(() => ranges.validateVehicleIdRanges([{ ...vehicleTypes[0], workSpeedKmh: 0 }]), /מהירות העבודה/);
  assert.throws(() => ranges.validateVehicleIdRanges([{ ...vehicleTypes[0], minId: 100, maxId: 10 }]), /אינו חוקי/);
});
