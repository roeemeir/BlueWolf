import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { createServer } from 'vite';

// Each node:test file executes in a separate process; configure the SQLite
// installation before loading the route module and its process-local DB.
const directory = await mkdtemp(join(tmpdir(), 'bluewolf-workspace-core-sync-'));
const oldEnv = Object.fromEntries(['BLUEWOLF_STORAGE', 'BLUEWOLF_SQLITE_PATH', 'BLUEWOLF_OPERATIONAL_CONFIG'].map(key => [key, process.env[key]]));
const configPath = join(directory, 'operational.json');
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = join(directory, 'workspace.sqlite');
process.env.BLUEWOLF_OPERATIONAL_CONFIG = configPath;
const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => {
  await vite.close();
  for (const [key, value] of Object.entries(oldEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(directory, { recursive: true, force: true });
});
const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule('/lib/bluewolf.ts');
const route = await vite.ssrLoadModule('/app/api/workspace/route.ts');
const state = structuredClone(DEFAULT_WORKSPACE);
const config = {
  influx: { url: 'http://previous.example', organization: 'previous', tokenEnv: 'BLUEWOLF_INFLUX_TOKEN', stream: {}, metrics: [] },
  join: { logicalGridSeconds: 1 }, polling: { logicalGridSeconds: 1 },
  templates: [{ id: 'existing-so' }], servers: [{ id: 1 }],
};
const url = 'http://127.0.0.1/api/workspace';
async function put(category, expectedRevision) {
  const response = await route.PUT(new Request(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category, expectedRevision, state, action: 'save', detail: 'Core/SQLite revision atomicity' }),
  }));
  return { status: response.status, body: await response.json() };
}

test('E2E SQLite rejected stale save cannot modify Core config, successful save commits first', async () => {
  await writeFile(configPath, JSON.stringify(config), 'utf8');
  const first = await put('configuration', 0);
  assert.equal(first.status, 200);
  assert.equal(first.body.revision, 1);
  const before = await readFile(configPath, 'utf8');
  const conflict = await put('influx', 0);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.revision, 1);
  assert.equal(conflict.body.runtimeSync, null);
  assert.equal(await readFile(configPath, 'utf8'), before, 'a rejected SQLite write must not touch operational configuration');

  const accepted = await put('influx', 1);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.revision, 2);
  assert.equal(accepted.body.runtimeSync.synced, true);
  assert.equal(accepted.body.runtimeSync.restartRequired, true, 'config write does not mean Core has applied it');
  const saved = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(saved.influx.url, state.influx.url);
  assert.deepEqual(saved.templates, config.templates);
  assert.deepEqual(saved.servers, config.servers);
  const persisted = await route.GET(new Request(url));
  assert.equal((await persisted.json()).revision, 2);
});

test('E2E Core config failure after a committed workspace save is reported as partial, not a failed SQLite write', async () => {
  await writeFile(configPath, '{invalid-json', 'utf8');
  const accepted = await put('influx', 2);
  assert.equal(accepted.status, 200, 'a committed SQLite change cannot be reported as an HTTP failure');
  assert.equal(accepted.body.revision, 3);
  assert.equal(accepted.body.runtimeSync.synced, false);
  assert.match(accepted.body.runtimeSync.reason, /סנכרון הליבה נכשל/);
  const persisted = await route.GET(new Request(url));
  assert.equal((await persisted.json()).revision, 3);
});

test('E2E SO template persistence is not misreported as complete operational Core application', async () => {
  await writeFile(configPath, JSON.stringify(config), 'utf8');
  const accepted = await put('templates', 3);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.revision, 4);
  assert.equal(accepted.body.runtimeSync.synced, false, 'the current adapter writes only SI templates');
  assert.match(accepted.body.runtimeSync.reason, /SO/);
  assert.equal(accepted.body.runtimeSync.restartRequired, true);
});
