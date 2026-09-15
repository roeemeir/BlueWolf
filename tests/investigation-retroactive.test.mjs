import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { applyRetroactiveTemplateBatch } = await vite.ssrLoadModule('/lib/investigation-retroactive.ts');

function result(eventId, serverId = 7, templateId = 'tpl-fixed') {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1',
    runId: `run-${eventId}`, scenarioId: `retroactive:${eventId}`, eventId, serverId, groupId: `group-${eventId}`,
    templateId, templateVersion: 'tpl-version', codeVersion: 'sha-1', configVersion: 'cfg-1',
    startAt: '2026-09-15T06:00:00Z', endAt: '2026-09-15T06:00:05Z', frameCount: 1,
    scoredFrameCount: 1, missingFrameCount: 0,
    summary: { sync: 90, route: 91, total: 90 }, rootCauses: [],
    points: [{ observedAt: '2026-09-15T06:00:05Z', pendingReason: null, group: { valid: true, sync: 90, route: 91, total: 90 }, members: [], navigation: [] }],
  };
}

test('retroactive template batch persists exactly once only after every Core recomputation matches provenance', async () => {
  const calls = [];
  let persistCalls = 0;
  const outcome = await applyRetroactiveTemplateBatch({
    candidates: [{ eventId: 'e1', serverId: 7 }, { eventId: 'e2', serverId: 7 }],
    templateId: 'tpl-fixed',
    recompute: async (eventId, templateId) => {
      calls.push([eventId, templateId]);
      return result(eventId, 7, templateId);
    },
    persist: async (results) => {
      persistCalls += 1;
      assert.deepEqual(results.map((item) => item.eventId), ['e1', 'e2']);
      return true;
    },
  });

  assert.deepEqual(calls, [['e1', 'tpl-fixed'], ['e2', 'tpl-fixed']]);
  assert.equal(persistCalls, 1);
  assert.equal(outcome.persisted, true);
  assert.deepEqual(outcome.results.map((item) => item.runId), ['run-e1', 'run-e2']);
});

test('retroactive template batch fails closed and never persists after a provenance mismatch', async () => {
  let persistCalls = 0;
  await assert.rejects(() => applyRetroactiveTemplateBatch({
    candidates: [{ eventId: 'e1', serverId: 7 }, { eventId: 'e2', serverId: 7 }],
    templateId: 'tpl-fixed',
    recompute: async (eventId) => eventId === 'e1' ? result('e1') : result('different-event'),
    persist: async () => { persistCalls += 1; return true; },
  }), /different event/);
  assert.equal(persistCalls, 0);
});

test('retroactive template batch rejects duplicate events before running Core', async () => {
  let recomputeCalls = 0;
  await assert.rejects(() => applyRetroactiveTemplateBatch({
    candidates: [{ eventId: 'e1', serverId: 7 }, { eventId: 'e1', serverId: 7 }],
    templateId: 'tpl-fixed',
    recompute: async (eventId) => { recomputeCalls += 1; return result(eventId); },
    persist: async () => true,
  }), /must be unique/);
  assert.equal(recomputeCalls, 0);
});
