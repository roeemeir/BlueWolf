import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule('/lib/bluewolf.ts');
const { syncSiTemplatesToOperationalConfig } = await vite.ssrLoadModule('/lib/si-runtime-sync.ts');

const so = {
  id: 'authored-so', family: 'SO', name: 'SO from saved Workspace', mix: '', constellation: '', law: '',
  values: [], isDefault: false, updatedAt: '2026-09-23T00:00:00Z',
  soSpec: { schemaVersion: 'so-direct.v2', chain: ['single'], relations: [],
    singleCounts: {}, doubleCounts: {}, generatorCounts: { single: 1, double: 0 },
    directPlacements: [
      { routeIndex: 0, phase: 0, direction: 'forward' },
      { routeIndex: 0, phase: .5, direction: 'forward' },
    ] },
};

const operational = () => ({
  influx: { url: 'http://example.test:8086', stream: { vehicleNumberColumn: 'vehicle_number', serverColumn: 'server', timeColumn: '_time' } },
  templates: [{ id: 'preserved-so', name: 'Separate existing Core template', default: false, routes: [] }],
  soTemplateBindings: [{ templateId: so.id, routeInstanceIds: ['r1'],
    slots: [{ placementIndex: 0, slotId: 'slot-a', vehicleType: 'TYPE_A' }, { placementIndex: 1, slotId: 'slot-b', vehicleType: 'TYPE_A' }] }],
  servers: [{ id: 1, tag: 'server-1', groups: [{ routeInstances: [{ id: 'r1', kind: 'single' }],
    members: [{ vehicleId: 101, vehicleType: 'TYPE_A', routeInstanceId: 'r1', workSpeedMps: 15 },
      { vehicleId: 102, vehicleType: 'TYPE_A', routeInstanceId: 'r1', workSpeedMps: 15 }] }] }],
});

test('saved SO positions and explicit operational bindings reach one atomic, re-readable Core config beside SI profiles', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bluewolf-so-core-binding-'));
  const configPath = path.join(directory, 'operational.json');
  const previous = process.env.BLUEWOLF_OPERATIONAL_CONFIG;
  try {
    const before = operational();
    await writeFile(configPath, JSON.stringify(before), 'utf8');
    process.env.BLUEWOLF_OPERATIONAL_CONFIG = configPath;
    const status = await syncSiTemplatesToOperationalConfig([so], DEFAULT_WORKSPACE.vehicleTypes);
    assert.equal(status.synced, true, 'writing config is not evidence of running Core');
    assert.equal(status.restartRequired, true);
    assert.deepEqual(status.soAppliedTemplateIds, [so.id]);
    assert.deepEqual(status.soMissingTemplateIds, []);
    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(saved.influx, before.influx, 'Influx join/connection truth must be preserved');
    assert.deepEqual(saved.servers, before.servers, 'vehicle IDs and work speeds are not fabricated or moved');
    assert.deepEqual(saved.soTemplateBindings, before.soTemplateBindings);
    assert.equal(saved.siVehicleTypes.length, DEFAULT_WORKSPACE.vehicleTypes.length);
    assert.equal(saved.templates[0].id, 'preserved-so');
    assert.deepEqual(saved.templates[1].routes[0].slots.map(({ id, vehicleType, quarter }) => ({ id, vehicleType, quarter })), [
      { id: 'slot-a', vehicleType: 'TYPE_A', quarter: 'Q0' },
      { id: 'slot-b', vehicleType: 'TYPE_A', quarter: 'Q2' },
    ]);
    assert.deepEqual((await rm(directory, { recursive: true, force: true })), undefined);
  } finally {
    if (previous === undefined) delete process.env.BLUEWOLF_OPERATIONAL_CONFIG;
    else process.env.BLUEWOLF_OPERATIONAL_CONFIG = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing deployment binding does not insert an invented SO template into Core bank', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bluewolf-so-unbound-'));
  const configPath = path.join(directory, 'operational.json');
  const previous = process.env.BLUEWOLF_OPERATIONAL_CONFIG;
  try {
    const before = operational();
    delete before.soTemplateBindings;
    await writeFile(configPath, JSON.stringify(before), 'utf8');
    process.env.BLUEWOLF_OPERATIONAL_CONFIG = configPath;
    const status = await syncSiTemplatesToOperationalConfig([so], DEFAULT_WORKSPACE.vehicleTypes);
    assert.deepEqual(status.soAppliedTemplateIds, []);
    assert.deepEqual(status.soMissingTemplateIds, [so.id]);
    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(saved.templates, before.templates);
  } finally {
    if (previous === undefined) delete process.env.BLUEWOLF_OPERATIONAL_CONFIG;
    else process.env.BLUEWOLF_OPERATIONAL_CONFIG = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
