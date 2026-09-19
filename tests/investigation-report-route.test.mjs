import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
process.env.BLUEWOLF_CORE_API_URL = 'http://core.test';
process.env.BLUEWOLF_CORE_API_TOKEN = 'secret';
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const route = await vite.ssrLoadModule('/app/api/investigation/report/route.ts');

let activeTemplateId = 'tpl-a';
let recomputeCalls = 0;
let originalFetch;

function recomputePayload() {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1', runId: 'run-1', scenarioId: 'report:event-1', eventId: 'event-1', serverId: 7, groupId: 'g1',
    templateId: 'tpl-a', templateVersion: 'tpl-v1', codeVersion: 'sha-1', configVersion: 'cfg-1',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:05Z', frameCount: 1, scoredFrameCount: 1, missingFrameCount: 0,
    summary: { sync: 90, route: 91, total: 90 }, rootCauses: [{ reason: 'so_template_phase', occurrences: 1 }],
    points: [{
      observedAt: '2026-09-15T06:00:05Z', pendingReason: null,
      group: { valid: true, sync: 90, route: 91, total: 90 },
      members: [{ memberId: 'v1', routeInstanceId: 'r1', slotId: 'a', expectedPhase: 0, positionErrorCycle: 0, valid: true, sync: 90, route: 91, total: 90, primaryReason: 'so_template_phase' }],
      navigation: [{ memberId: 'v1', vehicleIdentifier: 101, latitude: 32, longitude: 34.8, altitudeM: 10, velocityNorthMps: 1, velocityEastMps: 0, headingDeg: 0, active: true, reliability: 1 }],
    }],
  };
}

beforeEach(() => {
  activeTemplateId = 'tpl-a';
  recomputeCalls = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const authorization = new Headers(init.headers).get('authorization');
    assert.equal(authorization, 'Bearer secret');
    if (url.includes('/v1/investigation/events')) {
      return Response.json({
        schemaVersion: 'bluewolf.investigation-events.v1', serverId: 7,
        templates: [{ id: 'tpl-a', name: 'Template A' }],
        events: [{ eventId: 'event-1', serverId: 7, groupId: 'g1', startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:05Z', frameCount: 1, activeTemplateId }],
      });
    }
    if (url.includes('/v1/investigation/recompute')) {
      recomputeCalls += 1;
      const body = JSON.parse(String(init.body));
      assert.equal(body.eventId, 'event-1');
      assert.equal(body.templateId, 'tpl-a');
      return Response.json(recomputePayload());
    }
    throw new Error(`unexpected URL ${url}`);
  };
});

afterEach(() => { globalThis.fetch = originalFetch; });

test('report endpoint recomputes archived events and returns a real PDF with provenance headers', async () => {
  const response = await route.POST(new Request('http://app.test/api/investigation/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serverId: 7, from: '2026-09-15T06:00:00Z', to: '2026-09-15T07:00:00Z', overrides: [{ eventId: 'event-1', arena: 'arena-1' }] }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('x-bluewolf-report-source'), 'core-event-archive');
  assert.equal(response.headers.get('x-bluewolf-code-version'), 'sha-1');
  assert.equal(response.headers.get('x-bluewolf-config-version'), 'cfg-1');
  assert.equal(recomputeCalls, 1);
  const body = Buffer.from(await response.arrayBuffer()).toString('latin1');
  assert.ok(body.startsWith('%PDF-1.4'));
  assert.match(body, /event-1/);
  assert.match(body, /tpl-a/);
  assert.match(body, /sha-1/);
});

test('report data mode preserves Hebrew investigation metadata and exact recompute provenance for browser PDF rendering', async () => {
  const response = await route.POST(new Request('http://app.test/api/investigation/report', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      serverId: 7,
      format: 'data',
      from: '2026-09-15T06:00:00Z',
      to: '2026-09-15T07:00:00Z',
      overrides: [{ eventId: 'event-1', arena: 'זירה צפונית', note: 'הערת תחקור בעברית' }],
    }),
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^application\/json/);
  assert.equal(response.headers.get('x-bluewolf-report-source'), 'core-event-archive');
  assert.equal(response.headers.get('x-bluewolf-code-version'), 'sha-1');
  assert.equal(response.headers.get('x-bluewolf-config-version'), 'cfg-1');
  assert.equal(recomputeCalls, 1);
  const body = await response.json();
  assert.equal(body.schemaVersion, 'bluewolf.investigation-report-data.v1');
  assert.equal(body.source, 'core-event-archive');
  assert.equal(body.codeVersion, 'sha-1');
  assert.equal(body.configVersion, 'cfg-1');
  assert.equal(body.report.serverId, 7);
  assert.equal(body.report.events.length, 1);
  assert.equal(body.report.events[0].arena, 'זירה צפונית');
  assert.equal(body.report.events[0].note, 'הערת תחקור בעברית');
  assert.equal(body.report.events[0].result.eventId, 'event-1');
  assert.equal(body.report.events[0].result.templateId, 'tpl-a');
  assert.equal(body.report.events[0].result.codeVersion, 'sha-1');
  assert.equal(body.report.events[0].result.configVersion, 'cfg-1');
});

test('report endpoint rejects unsupported render formats rather than silently falling back', async () => {
  const response = await route.POST(new Request('http://app.test/api/investigation/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serverId: 7, format: 'demo' }),
  }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /format must be pdf or data/);
  assert.equal(recomputeCalls, 0);
});

test('report endpoint fails closed when an event has no original or explicit template provenance', async () => {
  activeTemplateId = null;
  const response = await route.POST(new Request('http://app.test/api/investigation/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serverId: 7, overrides: [] }),
  }));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.match(body.error, /cannot choose a template/);
  assert.deepEqual(body.missingTemplateEvents, ['event-1']);
  assert.equal(recomputeCalls, 0);
});


test('simulation report data uses the explicit seven-day simulator archive without calling Python Core', async () => {
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error('simulation report must not call Python Core'); };
  const response = await route.POST(new Request('http://app.test/api/investigation/report', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      serverId: 1,
      source: 'simulation',
      format: 'data',
      from: '2026-09-12T00:00:00.000Z',
      to: '2026-09-19T23:59:59.999Z',
      overrides: [],
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-bluewolf-report-source'), 'simulator-archive');
  assert.equal(externalCalls, 0);
  const body = await response.json();
  assert.equal(body.source, 'simulator-archive');
  assert.equal(body.report.serverId, 1);
  assert.ok(body.report.events.length >= 20);
  assert.ok(body.report.events.some((event) => event.result.family === 'SI'));
  assert.ok(body.report.events.some((event) => event.result.family === 'SO'));
});
