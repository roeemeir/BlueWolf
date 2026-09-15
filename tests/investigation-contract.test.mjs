import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const contract = await vite.ssrLoadModule('/lib/investigation-contract.ts');

test('investigation event contract keeps Core template bank and event provenance', () => {
  const result = contract.normalizeInvestigationEvents({
    schemaVersion: 'bluewolf.investigation-events.v1',
    serverId: 7,
    templates: [{ id: 'so-a', name: 'SO A' }, { id: 'so-b', name: 'SO B' }],
    events: [{
      eventId: 'g1@2026-09-15T06:00:00Z',
      serverId: 7,
      groupId: 'g1',
      startAt: '2026-09-15T06:00:00Z',
      endAt: '2026-09-15T06:01:00Z',
      frameCount: 61,
    }],
  });
  assert.equal(result.templates[1].id, 'so-b');
  assert.equal(result.events[0].frameCount, 61);
});

test('investigation event contract rejects a cross-server event', () => {
  assert.throws(() => contract.normalizeInvestigationEvents({
    schemaVersion: 'bluewolf.investigation-events.v1',
    serverId: 7,
    templates: [],
    events: [{
      eventId: 'bad', serverId: 8, groupId: 'g1',
      startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:01:00Z', frameCount: 1,
    }],
  }), /different server/);
});

test('recompute contract preserves pending frames and real version provenance', () => {
  const result = contract.normalizeEventRecompute({
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: 'run-1', scenarioId: 'scenario-1', eventId: 'event-1', serverId: 7, groupId: 'g1',
    templateId: 'so-a', templateVersion: 'tpl-hash', codeVersion: 'sha-1', configVersion: 'cfg-1',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:01Z', frameCount: 2,
    scoredFrameCount: 1, missingFrameCount: 1,
    summary: { sync: 88, route: 91, total: 89 },
    rootCauses: [{ reason: 'so_template_phase', occurrences: 2 }],
    points: [
      {
        observedAt: '2026-09-15T06:00:00Z',
        pendingReason: 'core_observations_incomplete',
        group: { valid: false, sync: null, route: null, total: null },
        members: [],
      },
      {
        observedAt: '2026-09-15T06:00:01Z',
        pendingReason: null,
        group: { valid: true, sync: 88, route: 91, total: 89 },
        members: [{
          memberId: 'v1', routeInstanceId: 'r1', slotId: 'a', expectedPhase: 0,
          positionErrorCycle: 0.02, valid: true, sync: 90, route: 91, total: 90,
          primaryReason: 'so_template_phase',
        }],
      },
    ],
  });
  assert.equal(result.codeVersion, 'sha-1');
  assert.equal(result.templateVersion, 'tpl-hash');
  assert.equal(result.rootCauses[0].occurrences, 2);
  assert.equal(result.points[0].pendingReason, 'core_observations_incomplete');
  assert.equal(result.missingFrameCount, 1);
  assert.throws(() => contract.normalizeEventRecompute({ ...result, codeVersion: '' }), /codeVersion/);
  assert.throws(() => contract.normalizeEventRecompute({ ...result, summary: { ...result.summary, sync: 101 } }), /\[0,100\]/);
  assert.throws(() => contract.normalizeEventRecompute({ ...result, missingFrameCount: 0 }), /must equal frameCount/);
});

test('pending recompute point cannot smuggle a score or member result', () => {
  const base = {
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: 'run-2', scenarioId: 'scenario-2', eventId: 'event-2', serverId: 7, groupId: 'g1',
    templateId: 'so-a', templateVersion: 'tpl-hash', codeVersion: 'sha-2', configVersion: 'cfg-2',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:00Z', frameCount: 1,
    scoredFrameCount: 0, missingFrameCount: 1,
    summary: { sync: null, route: null, total: null },
    rootCauses: [],
  };
  assert.throws(() => contract.normalizeEventRecompute({
    ...base,
    points: [{
      observedAt: base.startAt,
      pendingReason: 'core_scoring_not_ready',
      group: { valid: false, sync: 55, route: null, total: null },
      members: [],
    }],
  }), /pending point/);
});
