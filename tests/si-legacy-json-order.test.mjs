import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });
const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule('/lib/bluewolf.ts');
const { migrateUntouchedBuiltInSiTemplates } = await vite.ssrLoadModule('/lib/si-builtin-template-migration.ts');

const reverseKeys = (value) => Array.isArray(value)
  ? value.map(reverseKeys)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]))
    : value;

const legacy = () => reverseKeys(structuredClone(DEFAULT_WORKSPACE.templates));
const vehicleTypes = () => structuredClone(DEFAULT_WORKSPACE.vehicleTypes);

test('legacy SI presets survive SQLite/Cloud key reordering and become physically valid Core rules', () => {
  const reordered = legacy();
  const upgraded = migrateUntouchedBuiltInSiTemplates(reordered, vehicleTypes());
  const right = upgraded.find(({ id }) => id === 'tpl-si-90');
  const three = upgraded.find(({ id }) => id === 'tpl-si-120');
  assert.deepEqual(right.siPositions.map(({ ring, angleDeg }) => [ring, angleDeg]), [['inner', 0], ['middle', 90], ['outer', 180]]);
  assert.deepEqual(right.siPairs.map(({ first, second, angle }) => [first, second, angle]), [[0,1,90], [0,2,180], [1,2,90]]);
  assert.deepEqual(three.siPositions.map(({ angleDeg }) => angleDeg), [0, 120, 240]);
  assert.deepEqual(reordered.find(({ id }) => id === 'tpl-si-90').siPairs.map(({ angle }) => angle), [90, 90, 90], 'source must not mutate');
});

test('reordered custom metadata, edited nested pairs, missing/extra keys and non-legacy templates are untouched', () => {
  const variants = [
    (template) => ({ ...template, name: 'custom user name' }),
    (template) => ({ ...template, siPairs: template.siPairs.map((pair, i) => i === 1 ? { ...pair, angle: 180 } : pair) }),
    (template) => { const { updatedAt, ...missing } = template; return missing; },
    (template) => ({ ...template, extra: 'new field' }),
    (template) => ({ ...template, id: 'custom-preset' }),
  ];
  for (const customize of variants) {
    const templates = legacy();
    const replacement = customize(templates[1]);
    templates[1] = replacement;
    const migrated = migrateUntouchedBuiltInSiTemplates(templates, vehicleTypes());
    assert.equal(migrated[1], replacement, 'never overwrite a changed user record');
    assert.equal(migrated[1].siPositions, undefined);
    assert.equal(migrated[0].siPositions.length, 3, 'independent untouched 120 default still migrates');
  }
});
