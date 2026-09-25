import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { buildInvestigationPdf } = await vite.ssrLoadModule('/lib/investigation-pdf.ts');

function member(index) {
  return {
    memberId: `v${index}`, routeInstanceId: 'r1', slotId: `slot-${index}`, expectedPhase: index / 20,
    positionErrorCycle: index / 100, valid: true, sync: 90 - index, route: 91 - index / 2,
    total: 89 - index / 2, primaryReason: `reason-${index}`,
  };
}

function nav(index, offset = 0) {
  return {
    memberId: `v${index}`, vehicleIdentifier: 100 + index,
    latitude: 32 + index * 0.001 + offset, longitude: 34.8 + index * 0.001 + offset,
    altitudeM: 10 + index, velocityNorthMps: 1, velocityEastMps: index % 2,
    headingDeg: index % 2 ? 45 : 0, active: true, reliability: 1,
  };
}

function result() {
  const members = Array.from({ length: 14 }, (_, index) => member(index + 1));
  const navigation = Array.from({ length: 14 }, (_, index) => nav(index + 1, 0.002));
  return {
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: 'run-report-1', scenarioId: 'pdf-report:event-1', eventId: 'event-1', serverId: 7, groupId: 'g-1',
    templateId: 'tpl-so-real', templateVersion: 'tpl-abc123', codeVersion: 'sha-real-123', configVersion: 'cfg-real-456',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:05Z', frameCount: 2, scoredFrameCount: 1, missingFrameCount: 1,
    summary: { sync: 88, route: 91, total: 89 },
    rootCauses: Array.from({ length: 9 }, (_, index) => ({ reason: `root-cause-${index + 1}`, occurrences: 10 - index })),
    points: [
      {
        observedAt: '2026-09-15T06:00:00Z', pendingReason: 'core_observations_incomplete',
        group: { valid: false, sync: null, route: null, total: null }, members: [],
        navigation: Array.from({ length: 14 }, (_, index) => nav(index + 1)),
      },
      {
        observedAt: '2026-09-15T06:00:05Z', pendingReason: null,
        group: { valid: true, sync: 88, route: 91, total: 89 },
        members,
        navigation,
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
  assert.match(text, /root-cause-9/);
  assert.match(text, /v14 \| slot slot-14/);
  assert.match(text, /v14 \| vehicle 114/);
  assert.match(text, /Navigation map/);
  assert.match(text, /Group \+ every vehicle total score timeline/);
  assert.match(text, /no rows are silently truncated/);
  assert.match(text, /WGS84/);
  assert.match(text, /Source: immutable Core event archive \+ real template recomputation/);
  assert.match(text, /%%EOF/);
});

test('investigation PDF refuses an empty report', () => {
  assert.throws(() => buildInvestigationPdf({ serverId: 7, generatedAt: '2026-09-15T12:00:00Z', events: [] }), /at least one event/);
});
