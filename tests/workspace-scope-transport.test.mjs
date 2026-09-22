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

test('gateway 502/503/504 GET responses retry once, preserve scope, and never fabricate saved settings', async () => {
  for (const status of [502, 503, 504]) {
    let calls = 0;
    stubFetch(async (url, options) => {
      calls += 1;
      assert.equal(url, '/api/workspace/scope?type=server&id=server-1');
      assert.equal(options.cache, 'no-store');
      return calls === 1 ? new Response('<html>gateway unavailable</html>', { status }) : json({ state: { mapProfile: 'orthophoto' }, revision: 7 });
    });
    const row = await readWorkspaceScope('server', 'server-1');
    assert.equal(calls, 2);
    assert.equal(row.revision, 7);
    assert.deepEqual(row.state, { mapProfile: 'orthophoto' });
  }
});

test('a repeated non-JSON gateway 503 remains a visible HTTP error after only two safe reads', async () => {
  let calls = 0;
  stubFetch(async () => { calls += 1; return new Response('<html>bad gateway</html>', { status: 503 }); });
  await assert.rejects(() => readWorkspaceScope('server', '1'), /scope read failed \(503\)/);
  assert.equal(calls, 2);
});

test('malformed 200 scope success cannot silently reset saved map profile or revision', async () => {
  const invalidRows = [
    { ok: true },
    { state: null },
    { state: null, revision: '0' },
    { state: {}, revision: NaN },
    { state: {}, revision: -1 },
    { state: {}, revision: 0, updatedAt: {} },
    [],
  ];
  for (const row of invalidRows) {
    let calls = 0;
    stubFetch(async () => { calls += 1; return json(row); });
    await assert.rejects(() => readWorkspaceScope('server', '1'), /scope read (state is missing|revision is invalid|updatedAt is invalid|payload is invalid)/);
    assert.equal(calls, 1);
  }
  stubFetch(async () => json({ state: null, revision: 0, updatedAt: null }));
  assert.deepEqual(await readWorkspaceScope('server', '1'), { available: true, state: null, revision: 0, updatedAt: null });
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
  for (const response of [{ status: 'error', error: 'db unavailable' }, { ok: true, revision: 4 }, { ok: true, revision: '5' }, { ok: true, revision: 4.5 }]) {
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

test('invalid expectedRevision is rejected before any scoped PUT occurs', async () => {
  let calls = 0;
  stubFetch(async () => { calls += 1; return json({ ok: true, revision: 1 }); });
  for (const revision of [-1, 0.5, Number.NaN, '0']) {
    await assert.rejects(() => writeWorkspaceScope('server', '1', { mapProfile: 'engineering' }, revision, 'server-settings', 'mapProfile'), /expectedRevision is invalid/);
  }
  assert.equal(calls, 0);
});

test('concurrent revision conflict returns current revision without claiming map save success', async () => {
  let calls = 0;
  stubFetch(async () => { calls += 1; return json({ conflict: true, revision: 6 }, 409); });
  const result = await writeWorkspaceScope('server', 'server-1', { mapProfile: 'orthophoto' }, 4, 'server-settings', 'mapProfile');
  assert.deepEqual(result, { available: true, ok: false, conflict: true, revision: 6 });
  assert.equal(calls, 1);
});
