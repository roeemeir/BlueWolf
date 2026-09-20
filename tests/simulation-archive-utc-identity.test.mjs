import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });
const simulation = await vite.ssrLoadModule('/lib/simulation-investigation.ts');
const BEFORE = new Date('2026-09-19T23:59:00.000Z');
const AFTER = new Date('2026-09-20T00:01:00.000Z');

for (const serverId of [1, 2, 3]) {
  test(`server ${serverId}: historical event identity, family, seed and recomputed evidence survive UTC midnight`, () => {
    const previous = simulation.simulationEvents(serverId, BEFORE).filter((event) => event.startAt.startsWith('2026-09-18'));
    const next = simulation.simulationEvents(serverId, AFTER).filter((event) => event.startAt.startsWith('2026-09-18'));
    assert.equal(previous.length, 4);
    assert.deepEqual(next, previous, 'the same UTC event must not acquire another identity or family when the rolling window advances');
    for (const event of previous) {
      assert.match(event.eventId, /^sim-s[123]-utc2026-09-18-e[0-3]-(si|so)$/);
      const requested = { serverId, eventId: event.eventId, family: event.family, groupId: event.groupId, templateId: event.activeTemplateId };
      assert.deepEqual(
        simulation.recomputeSimulationEvent({ ...requested, now: BEFORE }),
        simulation.recomputeSimulationEvent({ ...requested, now: AFTER }),
        'a historical report must be reproducible across UTC midnight',
      );
    }
  });
}

test('seven-day archive expiry is explicit; unknown or cross-server event IDs never generate synthetic fallback evidence', () => {
  const before = simulation.simulationEvents(1, new Date('2026-09-20T12:00:00.000Z'));
  const expired = before.find((event) => event.startAt.startsWith('2026-09-14'));
  assert.ok(expired);
  const after = new Date('2026-09-21T12:00:00.000Z');
  assert.ok(!simulation.simulationEvents(1, after).some((event) => event.eventId === expired.eventId));
  const request = { serverId: 1, eventId: expired.eventId, templateId: expired.activeTemplateId, family: expired.family };
  assert.throws(() => simulation.recomputeSimulationEvent({ ...request, now: after }), /not present in the requested server archive/);
  assert.throws(() => simulation.recomputeSimulationEvent({ ...request, serverId: 2, now: new Date('2026-09-20T12:00:00.000Z') }), /not present in the requested server archive/);
  assert.throws(() => simulation.recomputeSimulationEvent({ ...request, eventId: 'invented', now: BEFORE }), /not present in the requested server archive/);
});
