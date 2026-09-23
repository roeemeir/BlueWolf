import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { bindSoDirectTemplatesToCore } = await vite.ssrLoadModule('/lib/so-runtime-config.ts');

const authored = (direction = 'forward') => ({
  id: 'so-direct-alpha', family: 'SO', name: 'SO explicit type binding', mix: '', constellation: '', law: '',
  isDefault: true, updatedAt: '2026-09-23T00:00:00Z', values: [],
  soSpec: {
    schemaVersion: 'so-direct.v2', chain: ['single'], relations: [],
    singleCounts: {}, doubleCounts: {}, generatorCounts: { single: 1, double: 0 },
    directPlacements: [
      { routeIndex: 0, phase: 0, direction },
      { routeIndex: 0, phase: .5, direction: 'forward' },
    ],
  },
});
const group = {
  routeInstances: [{ id: 'actual-route', kind: 'single' }],
  members: [
    { vehicleId: 101, vehicleType: 'TYPE_A', routeInstanceId: 'actual-route', workSpeedMps: 12 },
    { vehicleId: 102, vehicleType: 'TYPE_A', routeInstanceId: 'actual-route', workSpeedMps: 12 },
  ],
};
const binding = () => ({
  templateId: 'so-direct-alpha', routeInstanceIds: ['actual-route'],
  slots: [
    { placementIndex: 0, slotId: 'front', vehicleType: 'TYPE_A' },
    { placementIndex: 1, slotId: 'back', vehicleType: 'TYPE_A' },
  ],
});
const config = () => ({ templates: [{ id: 'legacy-core', name: 'Existing Core SO', default: false, routes: [] }], servers: [{ id: 1, groups: [group] }], soTemplateBindings: [binding()] });

test('typed SO direct placement enters the existing Core bank only with explicit routes, types and server member bindings', () => {
  const original = config();
  const result = bindSoDirectTemplatesToCore(original, [authored()]);
  assert.deepEqual(result.appliedTemplateIds, ['so-direct-alpha']);
  assert.deepEqual(result.missingTemplateIds, []);
  assert.equal(original.templates.length, 1, 'input operational config stays immutable');
  assert.deepEqual(result.config.templates[0], original.templates[0], 'unrelated Core template is preserved');
  assert.deepEqual(result.config.templates[1], {
    id: 'so-direct-alpha', name: 'SO explicit type binding', default: true,
    routes: [{ id: 'actual-route', kind: 'single', slots: [
      { id: 'front', vehicleType: 'TYPE_A', quarter: 'Q0' },
      { id: 'back', vehicleType: 'TYPE_A', quarter: 'Q2' },
    ] }],
  });
});

test('missing SO binding cannot be guessed from SI types or current groups', () => {
  const input = config();
  delete input.soTemplateBindings;
  const result = bindSoDirectTemplatesToCore(input, [authored()]);
  assert.deepEqual(result.appliedTemplateIds, []);
  assert.deepEqual(result.missingTemplateIds, ['so-direct-alpha']);
  assert.deepEqual(result.config.templates, input.templates);
});

test('incomplete, duplicate and mismatched SO deployment bindings fail closed', () => {
  const cases = [
    (input) => { input.soTemplateBindings[0].slots.pop(); },
    (input) => { input.soTemplateBindings[0].slots[1].placementIndex = 0; },
    (input) => { input.soTemplateBindings[0].slots[1].slotId = 'front'; },
    (input) => { input.soTemplateBindings[0].slots[1].vehicleType = 'TYPE_B'; },
    (input) => { input.soTemplateBindings[0].routeInstanceIds[0] = 'unobserved-route'; },
    (input) => { input.servers[0].groups[0].members[0].workSpeedMps = 0; },
  ];
  for (const mutate of cases) {
    const input = config(); mutate(input);
    assert.throws(() => bindSoDirectTemplatesToCore(input, [authored()]), Error);
  }
});

test('reverse SO slot cannot masquerade as supported forward Core quarter law', () => {
  assert.throws(() => bindSoDirectTemplatesToCore(config(), [authored('reverse')]), /reverse SO direction/);
});
