import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const runtime = await vite.ssrLoadModule('/lib/live-runtime.ts');
const history = await vite.ssrLoadModule('/lib/live-runtime-history.ts');
const display = await vite.ssrLoadModule('/lib/display-score-smoothing.ts');

function source(second, rawTotal, smoothedTotal, groupId = 'g1') {
  const observedAt = `2026-09-24T10:00:${String(second).padStart(2, '0')}Z`;
  const snapshot = runtime.simulationRuntimeSnapshot('1', observedAt);
  snapshot.source = { kind: 'python-core', health: 'healthy', navigationOrigin: 'simulation', syntheticNavigation: true };
  snapshot.groupList = [{ ...snapshot.groupList[0], id: groupId, total: smoothedTotal, rawTotal, sync: rawTotal, route: rawTotal, scoreValid: true, observedAt, event: { id: 'event-a', contextKey: 'a', startedAt: observedAt, active: true } }];
  snapshot.groups = { si: snapshot.groupList[0] };
  return snapshot;
}

beforeEach(() => history.clearLiveRuntimeHistory());

test('original Core total survives latest HTTP normalization, local history and compact HTTP replay', async () => {
  const raw = source(0, 20, 70);
  const snapshot = await runtime.fetchLiveRuntimeSnapshot('1', async () => ({ ok: true, json: async () => raw }));
  assert.equal(snapshot.groupList[0].rawTotal, 20);
  assert.equal(snapshot.groupList[0].total, 70);
  history.appendLiveRuntimeHistory(snapshot);
  const one = history.getLiveRuntimeHistory('1')[0];
  assert.equal(one.groups[0].rawTotal, 20);
  assert.equal(one.groups[0].total, 70);
  assert.equal(one.source.syntheticNavigation, true);

  const fetched = await history.fetchLiveRuntimeHistory('1', 10, async () => ({ ok: true, json: async () => ({ schemaVersion: history.LIVE_RUNTIME_HISTORY_SCHEMA_VERSION, serverId: '1', points: [one] }) }));
  history.clearLiveRuntimeHistory('1');
  history.applyLiveRuntimeHistory('1', fetched);
  assert.equal(history.getLiveRuntimeHistory('1')[0].groups[0].rawTotal, 20);
});

test('zero window shows actual raw total and 10-second window averages raw totals, never the already-smoothed alert totals', () => {
  for (const [second, raw, alertTotal] of [[0, 100, 100], [5, 0, 50], [10, 30, 43.3333333]]) {
    history.appendLiveRuntimeHistory(runtime.normalizeLiveRuntimeSnapshot(source(second, raw, alertTotal), '1'));
  }
  const input = history.getLiveRuntimeHistory('1');
  const before = structuredClone(input);
  const zero = display.smoothRuntimeHistoryForDisplay(input, 0);
  const ten = display.smoothRuntimeHistoryForDisplay(input, 10);
  assert.deepEqual(input, before, 'historical Core alert score and original evidence must stay untouched');
  assert.deepEqual(zero.map((point) => point.groups[0].total), [100, 0, 30]);
  assert.equal(ten[1].groups[0].total, 50);
  assert.equal(ten[2].groups[0].total, 130 / 3);
  assert.equal(ten[2].groups[0].rawTotal, 30);
  assert.equal(input[2].groups[0].total, 43.3333333, 'alert threshold source stays the Core ten-second score');
});

test('invalid raw totals fail closed and same-time legacy bootstrap cannot erase original score', () => {
  for (const invalid of [Number.NaN, Infinity, -1, 101, null]) {
    const snapshot = source(0, invalid, 80);
    assert.throws(() => runtime.normalizeLiveRuntimeSnapshot(snapshot, '1'), /invalid runtime group/);
  }
  const accepted = runtime.normalizeLiveRuntimeSnapshot(source(0, 20, 70), '1');
  history.appendLiveRuntimeHistory(accepted);
  const legacy = history.getLiveRuntimeHistory('1')[0];
  delete legacy.groups[0].rawTotal;
  assert.throws(() => history.applyLiveRuntimeHistory('1', [legacy]), /cannot downgrade an observed raw Core score/);
  assert.equal(history.getLiveRuntimeHistory('1')[0].groups[0].rawTotal, 20);
});

test('one window never blends legacy filtered and new raw Core totals at a schema migration boundary', () => {
  history.appendLiveRuntimeHistory(runtime.normalizeLiveRuntimeSnapshot(source(0, 30, 80), '1'));
  const legacy = { ...history.getLiveRuntimeHistory('1')[0], observedAt: '2026-09-24T10:00:05Z' };
  legacy.groups = [{ ...legacy.groups[0], total: 90 }];
  delete legacy.groups[0].rawTotal;
  history.applyLiveRuntimeHistory('1', [legacy]);
  const points = history.getLiveRuntimeHistory('1');
  const smoothed = display.smoothRuntimeHistoryForDisplay(points, 10);
  assert.equal(smoothed[1].groups[0].total, 90);
  assert.equal(smoothed[1].groups[0].rawTotal, undefined);
});
