import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
process.env.BLUEWOLF_CORE_API_URL = 'http://core.test';
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { POST } = await vite.ssrLoadModule('/app/api/investigation/recompute/route.ts');
const { verifyRecomputeResponseIdentity } = await vite.ssrLoadModule('/lib/investigation-recompute-identity.ts');
const { recomputeSimulationEvent } = await vite.ssrLoadModule('/lib/simulation-investigation.ts');
const source = recomputeSimulationEvent({
  serverId: 1, eventId: 'sim-s1-si-active', templateId: 'tpl-si-h',
  now: new Date('2026-09-18T12:00:00.000Z'),
});
const requestBody = { eventId: source.eventId, templateId: source.templateId, serverId: source.serverId, groupId: source.groupId, family: source.family };
let originalFetch;
let responsePayload;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  responsePayload = source;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://core.test/v1/investigation/recompute');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), requestBody);
    return Response.json(responsePayload);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

function request(body = requestBody) {
  return new Request('http://app.test/api/investigation/recompute', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('Core recompute response with the exact requested event, template and server is returned unchanged', async () => {
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-bluewolf-investigation'), 'python-core');
  const result = await response.json();
  assert.equal(result.eventId, source.eventId);
  assert.equal(result.serverId, source.serverId);
  assert.equal(result.templateId, source.templateId);
  assert.equal(verifyRecomputeResponseIdentity(requestBody, result), null);
});

test('Core response is rejected when an HTTP-200 body belongs to another event, template, server, group or family', async () => {
  for (const [name, change] of [
    ['eventId', { eventId: 'another-event' }],
    ['templateId', { templateId: 'another-template' }],
    ['serverId', { serverId: 2 }],
    ['groupId', { groupId: 'another-group' }],
    ['family', { family: 'SO' }],
  ]) {
    responsePayload = { ...source, ...change };
    const response = await POST(request());
    assert.equal(response.status, 502, `${name} mismatch must not render as success`);
    assert.match((await response.json()).error, new RegExp(name));
    assert.equal(response.headers.get('x-bluewolf-investigation'), null);
  }
});

test('Core recompute rejects an unbound or malformed request identity instead of accepting an unrelated result', async () => {
  for (const body of [
    { templateId: source.templateId, serverId: 1 },
    { eventId: source.eventId, serverId: 1 },
    { ...requestBody, serverId: 'not-a-number' },
  ]) {
    const result = verifyRecomputeResponseIdentity(body, source);
    assert.ok(result, 'missing identity must be an explicit provenance error');
  }
});
