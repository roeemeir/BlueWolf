import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
process.env.BLUEWOLF_CORE_API_URL = 'http://core.test';
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { GET } = await vite.ssrLoadModule('/app/api/investigation/recomputations/route.ts');
let originalFetch;
let upstream;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  upstream = {
    schemaVersion: 'bluewolf.event-recompute-history.v1',
    eventId: 'event-1',
    runs: [{
      runId: 'run-1', scenarioId: 'scenario-1', family: 'SO',
      templateId: 'so-a', templateVersion: 'tpl-v1', codeVersion: 'sha-1', configVersion: 'cfg-1',
      evidenceVersion: `evidence-${'c'.repeat(64)}`, createdAt: '2026-09-25T11:40:00Z',
      frameCount: 3, scoredFrameCount: 2, missingFrameCount: 1,
      summary: { sync: 80, route: 90, total: 82.5 },
    }],
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'http://core.test/v1/investigation/recomputations');
    assert.equal(url.searchParams.get('eventId'), 'event-1');
    assert.equal(url.searchParams.get('limit'), '25');
    assert.equal(init.cache, 'no-store');
    return Response.json(upstream);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('Core recompute history is normalized and keeps evidence versions without full replay payloads', async () => {
  const response = await GET(new Request('http://app.test/api/investigation/recomputations?eventId=event-1&limit=25'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-bluewolf-investigation'), 'python-core-history');
  const payload = await response.json();
  assert.equal(payload.eventId, 'event-1');
  assert.equal(payload.runs.length, 1);
  assert.equal(payload.runs[0].evidenceVersion, upstream.runs[0].evidenceVersion);
  assert.equal(payload.runs[0].summary.total, 82.5);
  assert.equal(payload.runs[0].points, undefined);
});

test('history proxy fails closed for cross-event or malformed evidence metadata', async () => {
  upstream = { ...upstream, eventId: 'another-event' };
  let response = await GET(new Request('http://app.test/api/investigation/recomputations?eventId=event-1&limit=25'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /another event/);
  upstream = { ...upstream, eventId: 'event-1', runs: [{ ...upstream.runs[0], evidenceVersion: 'not-an-evidence-version' }] };
  response = await GET(new Request('http://app.test/api/investigation/recomputations?eventId=event-1&limit=25'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /evidenceVersion/);
});

test('simulation history is explicit unavailable and invalid bounds are rejected before Core fetch', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({}); };
  let response = await GET(new Request('http://app.test/api/investigation/recomputations?eventId=event-1&source=simulation'));
  assert.equal(response.status, 422);
  assert.equal(called, false);
  response = await GET(new Request('http://app.test/api/investigation/recomputations?eventId=event-1&limit=201'));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
