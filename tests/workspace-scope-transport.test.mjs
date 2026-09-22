import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { readWorkspaceScope, writeWorkspaceScope } = await vite.ssrLoadModule('/lib/workspace-scope-client.ts');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

function stubFetch(implementation) { globalThis.fetch = implementation; }
function json(value, status = 200) { return Response.json(value, { status }); }

test('server map-profile GET retries one transport exception without changing scope or revision', async () => {
  let calls = 0;
  stubFetch(async (url, options) => {
    calls += 1;
    assert.equal(url, '/api/workspace/scope?type=server&id=server-1');
    assert.equal(options.cache, 'no-store');
    if (calls === 1) throw new TypeError('Load failed');
    return json({ state: { mapProfile: 'wmts-local' }, revision: 4, updatedAt: '2026-09-22T10:00:00Z' });
  });
  const result = await readWorkspaceScope('server', 'server-1');
  assert.equal(calls, 2);
  assert.deepEqual(result.state, { mapProfile: 'wmts-local' });
  assert.equal(result.revision, 4);
});

test('a repeated map-profile GET transport failure is surfaced instead of inventing saved state', async () => {
  let calls = 0;
  stubFetch(async () => { calls += 1; throw new TypeError('Load failed'); });
  await assert.rejects(() => readWorkspaceScope('server', '1'), /scope read transport failed twice.*Load failed/);
  assert.equal(calls, 2);
});

test('HTTP 501 unsupported scope is not retried or mistaken for durable persistence', async () => {
  let calls = 0;
  stubFetch(async () => { calls += 1; return new Response(null, { status: 501 }); });
  const result = await readWorkspaceScope('server', '1');
  assert.deepEqual(result, { available: false, state: null, revision: 0, updatedAt: null });
  assert.equal(calls, 1);
});

test('map-profile PUT requires explicit storage acknowledgment and advanced revision', async () => {
  let calls = 0;
  stubFetch(async (url, options) => {
    calls += 1;
    assert.equal(url, '/api/workspace/scope');
    assert.equal(options.method, 'PUT');
    const body = JSON.parse(options.body);
    assert.equal(body.scopeId, 'server-1');
    assert.deepEqual(body.state, { mapProfile: 'wmts-local' });
    assert.equal(body.expectedRevision, 4);
    return json({ ok: true, revision: 5 });
  });
  const result = await writeWorkspaceScope('server', 'server-1', { mapProfile: 'wmts-local' }, 4, 'server-settings', 'mapProfile');
  assert.deepEqual(result, { available: true, ok: true, conflict: false, revision: 5 });
  assert.equal(calls, 1);
});

test('unacknowledged 200 and non-advancing revision fail closed; PUT is never auto-retried', async () => {
  for (const response of [{ status: 'error', error: 'db unavailable' }, { ok: true, revision: 4 }]) {
    let calls = 0;
    stubFetch(async () => { calls += 1; return json(response); });
    await assert.rejects(() => writeWorkspaceScope('server', 'server-1', { mapProfile: 'engineering' }, 4, 'server-settings', 'mapProfile'), /not acknowledged|non-advancing/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  stubFetch(async () => { calls += 1; throw new TypeError('Load failed'); });
  await assert.rejects(() => writeWorkspaceScope('server', 'server-1', { mapProfile: 'engineering' }, 4, 'server-settings', 'mapProfile'), /Load failed/);
  assert.equal(calls, 1);
});

test('concurrent revision conflict returns current revision without claiming map save success', async () => {
  let calls = 0;
  stubFetch(async () => { calls += 1; return json({ conflict: true, revision: 6 }, 409); });
  const result = await writeWorkspaceScope('server', 'server-1', { mapProfile: 'orthophoto' }, 4, 'server-settings', 'mapProfile');
  assert.deepEqual(result, { available: true, ok: false, conflict: true, revision: 6 });
  assert.equal(calls, 1);
});
