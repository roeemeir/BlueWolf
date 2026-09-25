import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'bw-si-server-read-'));
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = join(dir, 'workspace.sqlite');
const nativeFetch = globalThis.fetch;
// This regression models the supported fully-offline installation: public
// WMTS discovery is best-effort, not a requirement for reading SI templates.
globalThis.fetch = async (input, init) => {
  if (String(input).includes('omniscale')) throw new Error('offline test');
  return nativeFetch(input, init);
};
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { globalThis.fetch = nativeFetch; await vite.close(); rmSync(dir, { recursive: true, force: true }); });
const { DEFAULT_WORKSPACE } = await vite.ssrLoadModule('/lib/bluewolf.ts');
const { readLocalWorkspace, writeLocalWorkspace } = await vite.ssrLoadModule('/lib/sqlite-workspace.ts');
const { GET } = await vite.ssrLoadModule('/app/api/workspace/route.ts');
const request = () => new Request('http://bluewolf.local/api/workspace');
const reverseKeys = (value) => Array.isArray(value)
  ? value.map(reverseKeys)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]))
    : value;

test('new SQLite installation exposes 90° adjacent SI defaults in server GET without creating revision', async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  const { state, revision } = await response.json();
  assert.equal(revision, 0);
  const template = state.templates.find(({ id }) => id === 'tpl-si-90');
  assert.deepEqual(template.siPositions.map(({ ring, angleDeg }) => [ring, angleDeg]), [['inner', 0], ['middle', 90], ['outer', 180]]);
  assert.deepEqual(template.siPairs.map(({ angle }) => angle), [90, 180, 90]);
  const persisted = await readLocalWorkspace('installation');
  assert.equal(persisted.revision, 0);
  assert.equal(persisted.state, null, 'GET must not persist built-in migration');
});

test('server GET upgrades only untouched legacy records even after JSON reorder; keeps stored revision and custom templates', async () => {
  const saved = reverseKeys(structuredClone(DEFAULT_WORKSPACE));
  saved.templates.find(({ id }) => id === 'tpl-si-120').name = 'edited by operator';
  const stored = await writeLocalWorkspace('installation', JSON.stringify(saved), 'configuration', 'legacy-save', 'test', 0);
  assert.equal(stored.ok, true);
  assert.equal(stored.revision, 1);
  const response = await GET(request());
  assert.equal(response.status, 200);
  const loaded = await response.json();
  assert.equal(loaded.revision, 1);
  const ninety = loaded.state.templates.find(({ id }) => id === 'tpl-si-90');
  const custom = loaded.state.templates.find(({ id }) => id === 'tpl-si-120');
  assert.deepEqual(ninety.siPositions.map(({ angleDeg }) => angleDeg), [0, 90, 180]);
  assert.equal(custom.name, 'edited by operator');
  assert.equal(custom.siPositions, undefined, 'custom data must not be invented');
  const raw = await readLocalWorkspace('installation');
  assert.equal(raw.revision, 1, 'no hidden write on GET');
  assert.deepEqual(raw.state.templates.find(({ id }) => id === 'tpl-si-90').siPairs.map(({ angle }) => angle), [90, 90, 90]);
});
