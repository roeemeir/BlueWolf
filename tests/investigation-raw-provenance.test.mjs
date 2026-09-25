import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const contract = await vite.ssrLoadModule('/lib/investigation-contract.ts');
const retro = await vite.ssrLoadModule('/lib/operator-retroactive-result.ts');
const smoothing = await vite.ssrLoadModule('/lib/display-score-smoothing.ts');
const pdf = await vite.ssrLoadModule('/lib/investigation-pdf.ts');

function payload() {
  return {
    schemaVersion: 'bluewolf.event-recompute.v1',
    family: 'SO',
    runId: 'run-test', scenarioId: 'scenario-test', eventId: 'event-test', serverId: 7, groupId: 'g1',
    templateId: 'tpl-a', templateVersion: 'tpl-v1', codeVersion: 'sha-test', configVersion: 'cfg-test',
    source: { kind: 'python-core', navigationOrigin: 'simulation', syntheticNavigation: true },
    startAt: '2026-09-25T04:00:00Z', endAt: '2026-09-25T04:00:01Z',
    frameCount: 2, scoredFrameCount: 2, missingFrameCount: 0,
    summary: { sync: 70, route: 90, total: 75 },
    rootCauses: [],
    points: [
      { observedAt: '2026-09-25T04:00:00Z', pendingReason: null, group: { valid: true, sync: 60, route: 90, total: 70, rawTotal: 70 }, members: [], navigation: [] },
      { observedAt: '2026-09-25T04:00:01Z', pendingReason: null, group: { valid: true, sync: 80, route: 90, total: 80, rawTotal: 80 }, members: [], navigation: [] },
    ],
  };
}

test('recompute keeps explicit TEST provenance and rawTotal through operator history smoothing', () => {
  const result = contract.normalizeEventRecompute(payload());
  assert.equal(result.source.syntheticNavigation, true);
  assert.equal(result.points[1].group.rawTotal, 80);
  const history = retro.historyWithEventRecompute([], result, { id: 'g1', name: 'G1', color: '#123456' });
  assert.equal(history[0].source.syntheticNavigation, true);
  assert.equal(history[0].groups[0].rawTotal, 70);
  assert.equal(smoothing.smoothRuntimeHistoryForDisplay(history, 0)[1].groups[0].total, 80);
  assert.equal(smoothing.smoothRuntimeHistoryForDisplay(history, 10)[1].groups[0].total, 75);
});

test('recompute cannot splice TEST archive scores into an unmarked point at the same timestamp', () => {
  const result = contract.normalizeEventRecompute(payload());
  const previous = [{
    schemaVersion: 'bluewolf.live-runtime-history.v1',
    serverId: '7',
    observedAt: result.points[0].observedAt,
    groups: [],
  }];
  assert.throws(
    () => retro.historyWithEventRecompute(previous, result, { id: 'g1', name: 'G1', color: '#123456' }),
    /source provenance/,
  );
});

test('rawTotal mismatch and partial TEST markers fail closed', () => {
  const badRaw = payload();
  badRaw.points[0].group.rawTotal = 71;
  assert.throws(() => contract.normalizeEventRecompute(badRaw), /rawTotal/);
  const badSource = payload();
  badSource.source = { kind: 'python-core', navigationOrigin: 'simulation' };
  assert.throws(() => contract.normalizeEventRecompute(badSource), /both valid markers|TEST navigation/);
});

test('investigation PDF visibly labels TEST navigation and uses raw recompute timeline', () => {
  const result = contract.normalizeEventRecompute(payload());
  const bytes = pdf.buildInvestigationPdf({
    serverId: 7,
    generatedAt: '2026-09-25T05:00:00Z',
    events: [{ result, arena: null, note: null }],
  });
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /TEST NAVIGATION/);
  assert.match(text, /synthetic raw navigation scored by Python Core/);
});
