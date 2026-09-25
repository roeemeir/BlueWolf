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

test('recompute contract preserves pending frames, navigation and real version provenance', () => {
  const navigation = [{
    memberId: 'v1', vehicleIdentifier: 101, latitude: 32.0, longitude: 34.8,
    altitudeM: 12, velocityNorthMps: 4, velocityEastMps: 3, headingDeg: 36.8698976458,
    active: true, reliability: 0.95,
  }];
  const result = contract.normalizeEventRecompute({
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: 'run-1', scenarioId: 'scenario-1', eventId: 'event-1', serverId: 7, groupId: 'g1',
    templateId: 'so-a', templateVersion: 'tpl-hash', codeVersion: 'sha-1', configVersion: 'cfg-1',
    evidenceVersion: `evidence-${'a'.repeat(64)}`,
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
        navigation,
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
        navigation: [{ ...navigation[0], latitude: 32.0001, longitude: 34.8001 }],
      },
    ],
  });
  assert.equal(result.codeVersion, 'sha-1');
  assert.equal(result.templateVersion, 'tpl-hash');
  assert.equal(result.evidenceVersion, `evidence-${'a'.repeat(64)}`);
  assert.equal(result.rootCauses[0].occurrences, 2);
  assert.equal(result.points[0].pendingReason, 'core_observations_incomplete');
  assert.equal(result.points[0].navigation[0].vehicleIdentifier, 101);
  assert.equal(result.points[1].navigation[0].latitude, 32.0001);
  assert.equal(result.missingFrameCount, 1);
  assert.throws(() => contract.normalizeEventRecompute({ ...result, codeVersion: '' }), /codeVersion/);
  assert.throws(() => contract.normalizeEventRecompute({ ...result, evidenceVersion: 'evidence-NOT-HEX' }), /evidenceVersion/);
  assert.throws(() => contract.normalizeEventRecompute({ ...result, summary: { ...result.summary, sync: 101 } }), /\[0,100\]/);
  assert.throws(() => contract.normalizeEventRecompute({ ...result, missingFrameCount: 0 }), /must equal frameCount/);
  const invalidNavigation = structuredClone(result);
  invalidNavigation.points[0].navigation[0].latitude = 95;
  assert.throws(() => contract.normalizeEventRecompute(invalidNavigation), /WGS84/);
});

test('older recompute payload without navigation remains readable as empty evidence', () => {
  const result = contract.normalizeEventRecompute({
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: 'legacy-run', scenarioId: 'legacy-scenario', eventId: 'legacy-event', serverId: 7, groupId: 'g1',
    templateId: 'so-a', templateVersion: 'tpl-hash', codeVersion: 'sha-legacy', configVersion: 'cfg-legacy',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:00Z', frameCount: 1,
    scoredFrameCount: 0, missingFrameCount: 1,
    summary: { sync: null, route: null, total: null }, rootCauses: [],
    points: [{
      observedAt: '2026-09-15T06:00:00Z', pendingReason: 'core_observations_incomplete',
      group: { valid: false, sync: null, route: null, total: null }, members: [],
    }],
  });
  assert.deepEqual(result.points[0].navigation, []);
  assert.equal(result.evidenceVersion, undefined);
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
      navigation: [],
    }],
  }), /pending point/);
});


test('recompute history contract preserves bounded version metadata and rejects malformed history', () => {
  const evidence = `evidence-${'b'.repeat(64)}`;
  const history = contract.normalizeEventRecomputeHistory({
    schemaVersion: 'bluewolf.event-recompute-history.v1',
    eventId: 'event-1',
    runs: [{
      runId: 'run-new', scenarioId: 'scenario-new', family: 'SI',
      templateId: 'si-a', templateVersion: 'tpl-v2', codeVersion: 'sha-2', configVersion: 'cfg-2',
      evidenceVersion: evidence, createdAt: '2026-09-25T11:30:00Z',
      frameCount: 4, scoredFrameCount: 3, missingFrameCount: 1,
      summary: { sync: 91, route: 88, total: 90 },
      source: { kind: 'python-core', navigationOrigin: 'simulation', syntheticNavigation: true },
    }],
  });
  assert.equal(history.eventId, 'event-1');
  assert.equal(history.runs[0].evidenceVersion, evidence);
  assert.equal(history.runs[0].family, 'SI');
  assert.equal(history.runs[0].summary.total, 90);
  assert.equal(history.runs[0].source.syntheticNavigation, true);
  assert.throws(() => contract.normalizeEventRecomputeHistory({ ...history, runs: [{ ...history.runs[0], evidenceVersion: 'bad' }] }), /evidenceVersion/);
  assert.throws(() => contract.normalizeEventRecomputeHistory({ ...history, runs: [history.runs[0], history.runs[0]] }), /runIds must be unique/);
});
