import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const directory = await mkdtemp(path.join(os.tmpdir(), 'bluewolf-gt-provenance-'));
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = path.join(directory, 'workspace.sqlite');
process.env.GITHUB_SHA = '1234567890abcdef1234567890abcdef12345678';
delete process.env.BLUEWOLF_CODE_SHA;
delete process.env.BLUEWOLF_CORE_API_URL;
delete process.env.BLUEWOLF_CORE_API_TOKEN;
delete process.env.BLUEWOLF_CONFIG_VERSION;

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: { port: 24734 } } });
after(async () => { await vite.close(); await rm(directory, { recursive: true, force: true }); });
const workspace = await vite.ssrLoadModule('/lib/sqlite-workspace.ts');
const gtRoute = await vite.ssrLoadModule('/app/api/gt-scenarios/route.ts');
const provenanceRoute = await vite.ssrLoadModule('/app/api/runtime-provenance/route.ts');

function scenario(revision = 0) {
  return {
    id: 'gt-provenance', name: 'Provenance GT', serverId: 'srv-1', arena: 'Arena A',
    startAt: '2026-09-16T08:00:00.000Z', endAt: '2026-09-16T09:00:00.000Z', notes: '', revision,
    groups: [{ id: 'g1', name: 'SO one', family: 'SO', routeId: 'route-so', templateId: 'tpl-so', participantIds: [201, 202] }],
    // A browser-supplied provenance value must be ignored by the server.
    provenance: {
      schemaVersion: 'bluewolf.runtime-provenance.v1',
      codeSha: 'deadbeef',
      configVersion: 'browser-forgery',
      source: 'web-workspace',
      capturedAt: '2020-01-01T00:00:00.000Z',
    },
  };
}

async function putScenario(value, expectedRevision) {
  return gtRoute.PUT(new Request('http://bluewolf.local/api/gt-scenarios', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: value, expectedRevision }),
  }));
}

test('BW-QA-008 GT saves server-owned code SHA and config fingerprint and persists them', async () => {
  await workspace.writeLocalWorkspace('installation', JSON.stringify({ marker: 'alpha', influx: { token: 'secret-a' } }), 'test', 'seed', '', 0);

  const response = await putScenario(scenario(), 0);
  assert.equal(response.status, 200);
  const firstPayload = await response.json();
  const first = firstPayload.scenario.provenance;
  assert.equal(first.schemaVersion, 'bluewolf.runtime-provenance.v1');
  assert.equal(first.codeSha, process.env.GITHUB_SHA);
  assert.match(first.configVersion, /^[0-9a-f]{64}$/);
  assert.equal(first.source, 'web-workspace');
  assert.notEqual(first.codeSha, 'deadbeef');
  assert.notEqual(first.configVersion, 'browser-forgery');
  assert.ok(Number.isFinite(Date.parse(first.capturedAt)));

  const read = await gtRoute.GET(new Request('http://bluewolf.local/api/gt-scenarios?id=gt-provenance'));
  assert.equal(read.status, 200);
  const stored = (await read.json()).scenario.provenance;
  assert.deepEqual(stored, first);

  await workspace.writeLocalWorkspace('installation', JSON.stringify({ marker: 'beta', influx: { token: 'secret-b' } }), 'test', 'change-config', '', 1);
  const secondResponse = await putScenario({ ...scenario(1), provenance: first }, 1);
  assert.equal(secondResponse.status, 200);
  const second = (await secondResponse.json()).scenario.provenance;
  assert.equal(second.codeSha, first.codeSha);
  assert.notEqual(second.configVersion, first.configVersion, 'a public config change must produce a new config version');
});

test('BW-QA-008 provenance endpoint exposes the same server-owned contract to GT UI', async () => {
  const response = await provenanceRoute.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.schemaVersion, 'bluewolf.runtime-provenance.v1');
  assert.equal(payload.codeSha, process.env.GITHUB_SHA);
  assert.match(payload.configVersion, /^[0-9a-f]{64}$/);
  assert.equal(payload.source, 'web-workspace');
});
