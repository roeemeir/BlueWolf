import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const previousBase = process.env.BLUEWOLF_CORE_API_URL;
delete process.env.BLUEWOLF_CORE_API_URL;
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); if (previousBase === undefined) delete process.env.BLUEWOLF_CORE_API_URL; else process.env.BLUEWOLF_CORE_API_URL = previousBase; });
const contract = await vite.ssrLoadModule('/lib/qa-contract.ts');
const qaRoute = await vite.ssrLoadModule('/app/api/qa/run/route.ts');

test('QA contract requires real run identity, code SHA, config version and consistent counts', () => {
  const normalized = contract.normalizeQaRun({
    schemaVersion: contract.QA_RUN_SCHEMA_VERSION,
    runId: 'qa-1', scenarioId: 'gt-7', codeSha: 'abc123', configVersion: '4', startedAt: '2026-09-15T06:00:00Z', durationMs: 1200, passed: false,
    categories: [{ id: 'route', title: 'Route detection', scenarios: 3, passed: 2, failed: 1, p50Ms: 20, p95Ms: 40 }],
  });
  assert.equal(normalized.categories[0].failed, 1);
  assert.throws(() => contract.normalizeQaRun({ ...normalized, codeSha: '' }), /codeSha/);
  assert.throws(() => contract.normalizeQaRun({ ...normalized, categories: [{ ...normalized.categories[0], scenarios: 4 }] }), /do not add up/);
});

test('QA API reports unavailable when Python Core runner is not configured and never fabricates results', async () => {
  const response = await qaRoute.POST(new Request('http://bluewolf.local/api/qa/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.status, 'unavailable');
  assert.equal('categories' in payload, false);
  assert.equal('passed' in payload, false);
});
