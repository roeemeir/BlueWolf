import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'bw-workspace-api-'));
process.env.BLUEWOLF_STORAGE = 'sqlite';
process.env.BLUEWOLF_SQLITE_PATH = join(dir, 'workspace.sqlite');
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });
const route = await vite.ssrLoadModule('/app/api/workspace/route.ts');

const validWkt = 'LINESTRING (34 32, 34.01 32, 34.01 32.01, 34 32)';
const invalidWkt = 'LINESTRING (34 32, 34.01 32, 34.01 32.01)';
const qaRun = {
  schemaVersion: 'bluewolf.qa-run.v1',
  runId: 'qa-persisted', scenarioId: 'full-regression', codeSha: 'abc123', configVersion: '7',
  startedAt: '2026-09-15T06:00:00Z', durationMs: 1234, passed: true,
  categories: [{ id: 'scoring', title: 'Scoring', scenarios: 1, passed: 1, failed: 0 }],
};
const investigationEdits = {
  'event-1': { note: 'validated event', templateId: 'so-a', arena: 'Arena-A' },
};

function put(state, expectedRevision) {
  return route.PUT(new Request('http://bluewolf.local/api/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, category: 'routes', action: 'save-bank', detail: 'wkt-api-regression', expectedRevision }),
  }));
}

function get() {
  return route.GET(new Request('http://bluewolf.local/api/workspace'));
}

test('invalid WKT cannot erase valid geometry, QA provenance or per-event arena metadata', async () => {
  const first = await put({ routes: [{ id: 'r1', geometry: validWkt }], qaRuns: [qaRun], investigationEdits }, 0);
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.ok, true);
  assert.equal(firstPayload.revision, 1);

  const rejected = await put({ routes: [{ id: 'r1', geometry: invalidWkt }], qaRuns: [], investigationEdits: {} }, 1);
  assert.equal(rejected.status, 400);

  const read = await get();
  assert.equal(read.status, 200);
  const saved = await read.json();
  assert.equal(saved.revision, 1);
  assert.equal(saved.state.routes[0].geometry, validWkt);
  assert.deepEqual(saved.state.qaRuns, [qaRun]);
  assert.deepEqual(saved.state.investigationEdits, investigationEdits);
  assert.equal(saved.state.investigationEdits['event-1'].arena, 'Arena-A');
  assert.equal(saved.logs.length, 1);
});
