import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const adapter = await vite.ssrLoadModule('/lib/operator-retroactive-result.ts');

function result() {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1', runId: 'run-new', scenarioId: 'operator:e1', eventId: 'e1', serverId: 1, groupId: 'g1',
    templateId: 'tpl-new', templateVersion: 'tpl-version-new', codeVersion: 'sha-one', configVersion: 'cfg-one',
    startAt: '2026-09-16T06:00:00Z', endAt: '2026-09-16T06:00:02Z', frameCount: 2, scoredFrameCount: 2, missingFrameCount: 0,
    routes: [], summary: { sync: 61, route: 71, total: 64 }, rootCauses: [{ reason: 'phase-error', occurrences: 2 }],
    lifecycle: { status: 'active', openedAt: '2026-09-16T06:00:00Z', endedAt: null, finalizeAt: null, closedAt: null, openingReason: 'group_became_active', endingReason: null, changes: [] },
    points: [
      { observedAt: '2026-09-16T06:00:00Z', pendingReason: null, group: { valid: true, sync: 40, route: 80, total: 50 }, members: [{ memberId: 'm1', routeInstanceId: 'r1', slotId: 's1', expectedPhase: 0, positionErrorCycle: .1, valid: true, sync: 35, route: 80, total: 47, primaryReason: 'phase-error' }], navigation: [{ memberId: 'm1', vehicleIdentifier: 101, latitude: 32, longitude: 34.8, altitudeM: 0, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 }] },
      { observedAt: '2026-09-16T06:00:02Z', pendingReason: null, group: { valid: true, sync: 60, route: 70, total: 63 }, members: [{ memberId: 'm1', routeInstanceId: 'r1', slotId: 's1', expectedPhase: .1, positionErrorCycle: .05, valid: true, sync: 55, route: 72, total: 59, primaryReason: 'phase-error' }], navigation: [{ memberId: 'm1', vehicleIdentifier: 101, latitude: 32.0001, longitude: 34.8001, altitudeM: 0, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 }] },
    ],
  };
}

const group = {
  key: 'so', id: 'g1', name: 'G1', family: 'SO', subtitle: 'runtime', total: 90, sync: 90, route: 90, confidence: 100, color: '#123456',
  members: [{ id: 101, typeId: 'storm', score: 90, sync: 90, route: 90, confidence: 100, phase: 0 }], templateId: 'tpl-old', reason: 'old', success: 'old',
};

test('OP-04 one recompute result changes card, history and trace consistently', () => {
  const recomputed = result();
  const card = adapter.groupFromEventRecompute(group, recomputed);
  assert.equal(card.templateId, 'tpl-new');
  assert.equal(card.total, 63);
  assert.equal(card.sync, 60);
  assert.equal(card.members[0].score, 59);
  assert.equal(card.members[0].sync, 55);

  const history = adapter.historyWithEventRecompute([], recomputed, group);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((point) => point.groups[0].total), [50, 63]);
  assert.ok(history.every((point) => point.groups[0].event.id === 'e1'));

  const trace = adapter.traceWithEventRecompute([], recomputed);
  assert.equal(trace.length, 2);
  assert.deepEqual(trace.map((point) => point.sync), [35, 55]);
  assert.ok(trace.every((point) => point.eventId === 'e1' && point.vehicleId === 101));
});

test('OP-04 version guard rejects a different code/config/template version', () => {
  const recomputed = result();
  const expected = { eventId: 'e1', templateId: 'tpl-new', codeVersion: 'sha-one', configVersion: 'cfg-one', templateVersion: 'tpl-version-new' };
  assert.equal(adapter.sameRecomputeVersion(recomputed, expected), true);
  assert.equal(adapter.sameRecomputeVersion({ ...recomputed, codeVersion: 'sha-two' }, expected), false);
  assert.equal(adapter.sameRecomputeVersion({ ...recomputed, configVersion: 'cfg-two' }, expected), false);
  assert.equal(adapter.sameRecomputeVersion({ ...recomputed, templateVersion: 'tpl-two' }, expected), false);
});
