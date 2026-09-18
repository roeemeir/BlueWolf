import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bluewolf-map-secret-'));
const dbPath = path.join(tempDir, 'bluewolf.sqlite');
const previous = {
  storage: process.env.BLUEWOLF_STORAGE,
  sqlite: process.env.BLUEWOLF_SQLITE_PATH,
  demo: process.env.BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN,
};
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = dbPath;
process.env.BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN = 'demo-test-secret';

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  root,
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
  for (const [key, value] of Object.entries(previous)) {
    const envKey = key === 'storage' ? 'BLUEWOLF_STORAGE'
      : key === 'sqlite' ? 'BLUEWOLF_SQLITE_PATH'
      : 'BLUEWOLF_PUBLIC_WMTS_DEMO_TOKEN';
    if (value === undefined) delete process.env[envKey];
    else process.env[envKey] = value;
  }
  await rm(tempDir, { recursive: true, force: true });
});

test('BW-OFF-010 default WMTS demo key is persisted only in SQLite secret storage', async () => {
  const profile = await vite.ssrLoadModule('/lib/default-map-profile.ts');
  const sqlite = await vite.ssrLoadModule('/lib/sqlite-workspace.ts');
  const local = await vite.ssrLoadModule('/lib/local-map-source-server.ts');

  const state = profile.ensureTelAvivDemoMapState({ mapServers: [], settings: {} });
  const serialized = JSON.stringify(state);
  assert.match(serialized, /__BLUEWOLF_MAP_TOKEN__/);
  assert.doesNotMatch(serialized, /demo-test-secret/);

  const saved = await sqlite.writeLocalWorkspace(
    local.LOCAL_WORKSPACE_ID,
    serialized,
    'map-source',
    'seed-default-wmts',
    'test fixture',
    0,
  );
  assert.equal(saved.ok, true);

  const source = await local.localMapSource(profile.DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  assert.equal(source.tokenMode, 'path');
  assert.equal(await sqlite.hasLocalMapSourceToken(local.LOCAL_WORKSPACE_ID, source.id), false);

  const token = await local.localMapSourceSecret(source);
  assert.equal(token, 'demo-test-secret');
  assert.equal(await sqlite.hasLocalMapSourceToken(local.LOCAL_WORKSPACE_ID, source.id), true);

  const persisted = await sqlite.readLocalWorkspace(local.LOCAL_WORKSPACE_ID);
  const persistedJson = JSON.stringify(persisted.state);
  assert.match(persistedJson, /__BLUEWOLF_MAP_TOKEN__/);
  assert.doesNotMatch(persistedJson, /demo-test-secret/);
});
