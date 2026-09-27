import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule('/lib/bluewolf.ts');
const { migrateUntouchedBuiltInSiTemplates } = await vite.ssrLoadModule('/lib/si-builtin-template-migration.ts');
const { siAdjacentSummary } = await vite.ssrLoadModule('/lib/si-adjacent-angles.ts');
const { operationalSiTemplates } = await vite.ssrLoadModule('/lib/si-runtime-config.ts');
const source = () => structuredClone(DEFAULT_WORKSPACE.templates);
const types = () => structuredClone(DEFAULT_WORKSPACE.vehicleTypes);

test('untouched built-in 90° forms 0,90,180 independent of ring; Core gets 90/180/90', () => {
  const before = source();
  const migrated = migrateUntouchedBuiltInSiTemplates(before, types());
  const preset = migrated.find((template) => template.id === 'tpl-si-90');
  assert.deepEqual(preset.siPositions.map((slot) => [slot.ring, slot.angleDeg]), [['inner', 0], ['middle', 90], ['outer', 180]]);
  assert.deepEqual(siAdjacentSummary(preset.siPositions), [90, 90]);
  assert.deepEqual(preset.values, [90, 180, 90]);
  assert.deepEqual(preset.siPairs.map(({ first, second, angle }) => [first, second, angle]), [[0,1,90], [0,2,180], [1,2,90]]);
  assert.deepEqual(before.find((template) => template.id === 'tpl-si-90').values, [90, 90, 90], 'never mutate historical source');
  const operational = operationalSiTemplates(migrated, types()).find((template) => template.id === 'tpl-si-90');
  assert.deepEqual(operational.slots.map((slot) => [slot.routeRole, slot.phaseOffset]), [['inner', 0], ['middle', 0.25], ['outer', 0.5]]);
});

test('untouched 120° default has physical coordinates and stays all-pairs 120°', () => {
  const migrated = migrateUntouchedBuiltInSiTemplates(source(), types());
  const preset = migrated.find((template) => template.id === 'tpl-si-120');
  assert.deepEqual(preset.siPositions.map((slot) => slot.angleDeg), [0, 120, 240]);
  assert.deepEqual(siAdjacentSummary(preset.siPositions), [120, 120]);
  assert.deepEqual(preset.values, [120, 120, 120]);
  assert.deepEqual(operationalSiTemplates(migrated, types()).find((template) => template.id === 'tpl-si-120').slots.map((slot) => slot.phaseOffset), [0, 1/3, 2/3]);
});

test('custom and already coordinate-authored templates are unchanged, with stable reruns', () => {
  const customized = source();
  customized[1].siPairs[0].angle = 120;
  const migrated = migrateUntouchedBuiltInSiTemplates(customized, types());
  assert.equal(migrated[1], customized[1]);
  assert.equal(migrated[1].siPositions, undefined);
  assert.equal(migrated[0].siPositions.length, 3);
  const repeated = migrateUntouchedBuiltInSiTemplates(migrated, types());
  assert.deepEqual(repeated, migrated);
  const coordinates = source();
  coordinates[1].siPositions = [{ typeId: 'storm', ring: 'inner', angleDeg: 30 }, { typeId: 'lightning', ring: 'middle', angleDeg: 120 }];
  assert.equal(migrateUntouchedBuiltInSiTemplates(coordinates, types())[1], coordinates[1]);
});

test('changed built-in metadata or incompatible vehicle ring permissions never gets fabricated coordinates', () => {
  const renamed = source();
  renamed[1].name = 'תבנית בעריכת משתמש';
  assert.equal(migrateUntouchedBuiltInSiTemplates(renamed, types())[1].siPositions, undefined);
  const modifiedTypes = types();
  modifiedTypes[1].siRoles = ['inner'];
  assert.equal(migrateUntouchedBuiltInSiTemplates(source(), modifiedTypes)[1].siPositions, undefined);
});
