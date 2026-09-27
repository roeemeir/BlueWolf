import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const directory = await mkdtemp(path.join(os.tmpdir(), 'bluewolf-gt-'));
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = path.join(directory, 'gt.sqlite');
const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: { port: 24733 } } });
after(async () => { await vite.close(); await rm(directory, { recursive: true, force: true }); });
const contract = await vite.ssrLoadModule('/lib/gt-scenario-contract.ts');
const storage = await vite.ssrLoadModule('/lib/sqlite-gt-scenarios.ts');

function scenario(id, suffix = '') {
  return {
    id, name: `Scenario ${suffix || id}`, serverId: 'srv-1', arena: 'Arena A',
    startAt: '2026-09-16T08:00:00.000Z', endAt: '2026-09-16T09:00:00.000Z', notes: '', revision: 0,
    groups: [
      { id: `${id}-si`, name: 'SI one', family: 'SI', routeId: 'route-si', templateId: 'tpl-si', participantIds: [101, 102] },
      { id: `${id}-so`, name: 'SO two', family: 'SO', routeId: 'route-so', templateId: 'tpl-so', participantIds: [201, 202, 203] },
    ],
  };
}

test('BW-DEV-008 accepts one GT scenario with multiple independent groups', () => {
  const normalized = contract.normalizeGtScenario(scenario('gt-multi'));
  assert.equal(normalized.groups.length, 2);
  assert.deepEqual(normalized.groups.map((group) => group.family), ['SI', 'SO']);
  assert.equal(contract.gtScenarioSummary(normalized).participantCount, 5);
  assert.throws(() => contract.normalizeGtScenario({ ...scenario('gt-bad'), groups: [
    { id: 'a', name: 'A', family: 'SI', routeId: 'r1', templateId: 't1', participantIds: [7, 8] },
    { id: 'b', name: 'B', family: 'SO', routeId: 'r2', templateId: 't2', participantIds: [8, 9] },
  ] }), /belongs to both GT groups/);
});

test('BW-DEV-008 persists and reloads a multi-group GT scenario with optimistic revision', async () => {
  const first = await storage.writeLocalGtScenario(scenario('gt-persist'), 0);
  assert.equal(first.ok, true);
  assert.equal(first.revision, 1);
  const loaded = await storage.readLocalGtScenario('gt-persist');
  assert.equal(loaded.groups.length, 2);
  assert.deepEqual(loaded.groups[1].participantIds, [201, 202, 203]);
  const conflict = await storage.writeLocalGtScenario({ ...loaded, name: 'stale edit' }, 0);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.revision, 1);
});

test('BW-DEV-015 indexes and pages hundreds of stored GT scenarios independent of demo data', async () => {
  for (let index = 0; index < 220; index += 1) {
    const id = `scale-${String(index).padStart(3, '0')}`;
    const saved = await storage.writeLocalGtScenario(scenario(id, String(index)), 0);
    assert.equal(saved.ok, true);
  }
  const firstPage = await storage.listLocalGtScenarios({ limit: 50, offset: 0 });
  const latePage = await storage.listLocalGtScenarios({ limit: 50, offset: 200 });
  assert.ok(firstPage.total >= 221);
  assert.equal(firstPage.items.length, 50);
  assert.ok(latePage.items.length >= 21);
  assert.ok(latePage.items.every((item) => item.groupCount === 2));
});
