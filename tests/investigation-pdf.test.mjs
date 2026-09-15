import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { buildInvestigationPdf } = await vite.ssrLoadModule('/lib/investigation-pdf.ts');

function result() {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: 'run-report-1', scenarioId: 'pdf-report:event-1', eventId: 'event-1', serverId: 7, groupId: 'g-1',
    templateId: 'tpl-so-real', templateVersion: 'tpl-abc123', codeVersion: 'sha-real-123', configVersion: 'cfg-real-456',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:05Z', frameCount: 2, scoredFrameCount: 1, missingFrameCount: 1,
    summary: { sync: 88, route: 91, total: 89 },
    rootCauses: [{ reason: 'so_template_phase', occurrences: 2 }],
    points: [
      {
        observedAt: '2026-09-15T06:00:00Z', pendingReason: 'core_observations_incomplete',
        group: { valid: false, sync: null, route: null, total: null }, members: [],
        navigation: [
          { memberId: 'v1', vehicleIdentifier: 101, latitude: 32.0, longitude: 34.8, altitudeM: 10, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 },
          { memberId: 'v2', vehicleIdentifier: 102, latitude: 32.001, longitude: 34.801, altitudeM: 11, velocityNorthMps: 0, velocityEastMps: 1, headingDeg: 90, active: true, reliability: 1 },
        ],
      },
      {
        observedAt: '2026-09-15T06:00:05Z', pendingReason: null,
        group: { valid: true, sync: 88, route: 91, total: 89 },
        members: [
          { memberId: 'v1', routeInstanceId: 'r1', slotId: 'a', expectedPhase: 0, positionErrorCycle: 0.02, valid: true, sync: 90, route: 91, total: 90, primaryReason: 'so_template_phase' },
          { memberId: 'v2', routeInstanceId: 'r1', slotId: 'b', expectedPhase: 0.5, positionErrorCycle: 0.03, valid: true, sync: 86, route: 91, total: 88, primaryReason: 'so_template_phase' },
        ],
        navigation: [
          { memberId: 'v1', vehicleIdentifier: 101, latitude: 32.002, longitude: 34.802, altitudeM: 10, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 },
          { memberId: 'v2', vehicleIdentifier: 102, latitude: 32.003, longitude: 34.803, altitudeM: 11, velocityNorthMps: 0, velocityEastMps: 1, headingDeg: 90, active: true, reliability: 1 },
        ],
      },
    ],
  };
}

test('investigation PDF is a real binary document with truth provenance and engineering content', () => {
  const bytes = buildInvestigationPdf({
    serverId: 7,
    from: '2026-09-15T06:00:00Z',
    to: '2026-09-15T07:00:00Z',
    generatedAt: '2026-09-15T12:00:00Z',
    events: [{ result: result(), arena: 'arena-1', note: 'verified event' }],
  });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /Blue Wolf Investigation Report/);
  assert.match(text, /event-1/);
  assert.match(text, /tpl-so-real/);
  assert.match(text, /tpl-abc123/);
  assert.match(text, /sha-real-123/);
  assert.match(text, /cfg-real-456/);
  assert.match(text, /so_template_phase/);
  assert.match(text, /Navigation map/);
  assert.match(text, /Group \+ vehicle total score timeline/);
  assert.match(text, /WGS84/);
  assert.match(text, /%%EOF/);
  assert.doesNotMatch(text, /demo/i);
});

test('investigation PDF refuses an empty report', () => {
  assert.throws(() => buildInvestigationPdf({ serverId: 7, generatedAt: '2026-09-15T12:00:00Z', events: [] }), /at least one event/);
});
