import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const directory = await mkdtemp(path.join(os.tmpdir(), 'bluewolf-map-source-'));
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = path.join(directory, 'workspace.sqlite');

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); await rm(directory, { recursive: true, force: true }); });
const sqlite = await vite.ssrLoadModule('/lib/sqlite-workspace.ts');
const validation = await vite.ssrLoadModule('/lib/workspace-validation.ts');
const tokenRoute = await vite.ssrLoadModule('/app/api/map-sources/token/route.ts');
const proxyRoute = await vite.ssrLoadModule('/app/api/map-sources/proxy/route.ts');

const workspaceState = validation.normalizeAndValidateWorkspaceState({
  routes: [], vehicleTypes: [],
  mapServers: [
    { id: 'wms-private', name: 'WMS', kind: 'wms', baseUrl: 'https://gis.internal/wms', layer: 'bluewolf', crs: 'CRS:84', attribution: 'GIS', enabled: true, isDefault: true, tokenMode: 'query', tokenQueryParam: 'access_token' },
    { id: 'wmts-private', name: 'WMTS', kind: 'wmts', baseUrl: 'https://tiles.internal/wmts', layer: 'ortho', tileMatrixSet: 'WebMercatorQuad', attribution: 'GIS', enabled: true, isDefault: false, tokenMode: 'bearer' },
  ],
});
await sqlite.writeLocalWorkspace('installation', JSON.stringify(workspaceState), 'test', 'seed', 'map proxy fixture');

async function body(response) { return await response.json(); }

test('BW-OFF-012 records backwards-compatible local schema migration for map source secrets', async () => {
  const migrations = await sqlite.listLocalSchemaMigrations();
  assert.ok(migrations.some((row) => row.id === '001-workspace-version-history'));
  assert.ok(migrations.some((row) => row.id === '002-map-source-secrets'));
});

test('BW-OFF-010 token API never returns token value and stores secret outside workspace state', async () => {
  const setResponse = await tokenRoute.PUT(new Request('http://local/api/map-sources/token', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: 'wms-private', token: 'super-secret-wms' }),
  }));
  assert.equal(setResponse.status, 200);
  assert.deepEqual(await body(setResponse), { ok: true, sourceId: 'wms-private', configured: true, storage: 'sqlite' });
  const statusResponse = await tokenRoute.GET(new Request('http://local/api/map-sources/token?sourceId=wms-private'));
  const status = await body(statusResponse);
  assert.deepEqual(status, { sourceId: 'wms-private', tokenMode: 'query', configured: true });
  assert.equal(JSON.stringify(status).includes('super-secret-wms'), false);
  const workspace = await sqlite.readLocalWorkspace('installation');
  assert.equal(JSON.stringify(workspace.state).includes('super-secret-wms'), false);
  assert.equal(await sqlite.readLocalMapSourceToken('installation', 'wms-private'), 'super-secret-wms');
});

test('BW-OFF-010 WMS proxy injects query token upstream but client request and response do not expose it', async () => {
  const originalFetch = globalThis.fetch;
  let upstream = null;
  globalThis.fetch = async (input, init) => {
    upstream = { url: String(input), headers: new Headers(init?.headers) };
    return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const clientUrl = 'http://local/api/map-sources/proxy?sourceId=wms-private&bbox=34.7,31.9,34.9,32.1&width=1000&height=570';
    assert.doesNotMatch(clientUrl, /super-secret-wms/);
    const response = await proxyRoute.GET(new Request(clientUrl));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-bluewolf-map-source'), 'wms-private');
    assert.ok(upstream.url.includes('access_token=super-secret-wms'));
    assert.equal(upstream.headers.has('authorization'), false);
    assert.equal([...response.headers.entries()].some(([, value]) => value.includes('super-secret-wms')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('BW-OFF-010 WMTS bearer token is upstream-only and redirects are rejected', async () => {
  await tokenRoute.PUT(new Request('http://local/api/map-sources/token', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: 'wmts-private', token: 'super-secret-wmts' }),
  }));
  const originalFetch = globalThis.fetch;
  let upstream = null;
  globalThis.fetch = async (input, init) => {
    upstream = { url: String(input), headers: new Headers(init?.headers), redirect: init?.redirect };
    return new Response(Uint8Array.from([4, 5, 6]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const clientUrl = 'http://local/api/map-sources/proxy?sourceId=wmts-private&tileMatrix=12&tileRow=1600&tileCol=2500';
    const response = await proxyRoute.GET(new Request(clientUrl));
    assert.equal(response.status, 200);
    assert.equal(upstream.headers.get('authorization'), 'Bearer super-secret-wmts');
    assert.doesNotMatch(upstream.url, /super-secret-wmts/);
    assert.equal(upstream.redirect, 'manual');
  } finally { globalThis.fetch = originalFetch; }
});

test('BW-OFF-010 missing private token fails closed before upstream fetch', async () => {
  await tokenRoute.DELETE(new Request('http://local/api/map-sources/token?sourceId=wmts-private', { method: 'DELETE' }));
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not fetch'); };
  try {
    const response = await proxyRoute.GET(new Request('http://local/api/map-sources/proxy?sourceId=wmts-private&tileMatrix=12&tileRow=1600&tileCol=2500'));
    assert.equal(response.status, 502);
    assert.match((await body(response)).error, /requires a configured token/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});
