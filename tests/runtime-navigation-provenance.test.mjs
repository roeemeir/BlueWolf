import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const runtime = await vite.ssrLoadModule('/lib/live-runtime.ts');
const history = await vite.ssrLoadModule('/lib/live-runtime-history.ts');
const marker = { kind: 'python-core', navigationOrigin: 'simulation', syntheticNavigation: true };
const at = '2026-09-24T12:00:00.000Z';

function coreSnapshot() {
  const row = runtime.simulationRuntimeSnapshot('1', at);
  row.source = { ...marker, health: 'healthy', detail: 'TEST NAVIGATION from real Python Core' };
  return row;
}

function compactPoint() {
  return {
    schemaVersion: history.LIVE_RUNTIME_HISTORY_SCHEMA_VERSION,
    serverId: '1',
    observedAt: at,
    groups: [{ id: 'g1', name: 'SO', color: '#123456', total: 84, sync: 85, route: 83, scoreValid: true }],
    source: { ...marker },
  };
}

beforeEach(() => history.clearLiveRuntimeHistory());

test('authenticated latest and compact-history proxies preserve TEST navigation source from Core', async () => {
  const raw = coreSnapshot();
  const observed = await runtime.fetchLiveRuntimeSnapshot('1', async () => ({ ok: true, json: async () => raw }));
  assert.equal(observed.source.kind, 'python-core');
  assert.equal(observed.source.navigationOrigin, 'simulation');
  assert.equal(observed.source.syntheticNavigation, true);
  history.appendLiveRuntimeHistory(observed);
  assert.deepEqual(history.getLiveRuntimeHistory('1')[0].source, marker);

  const point = compactPoint();
  const fetched = await history.fetchLiveRuntimeHistory('1', 12, async () => ({
    ok: true,
    json: async () => ({ schemaVersion: history.LIVE_RUNTIME_HISTORY_SCHEMA_VERSION, serverId: '1', points: [point] }),
  }));
  assert.deepEqual(fetched[0].source, marker);
  history.clearLiveRuntimeHistory('1');
  history.applyLiveRuntimeHistory('1', fetched);
  assert.deepEqual(history.getLiveRuntimeHistory('1')[0].source, marker);
});

test('partial, contradictory and falsely operationalized TEST source fields fail closed', () => {
  for (const bad of [
    { kind: 'python-core', navigationOrigin: 'simulation' },
    { kind: 'python-core', syntheticNavigation: true },
    { kind: 'python-core', navigationOrigin: 'simulation', syntheticNavigation: false },
    { kind: 'simulation', navigationOrigin: 'simulation', syntheticNavigation: true },
  ]) {
    const raw = coreSnapshot();
    raw.source = { ...bad, health: 'healthy' };
    assert.throws(() => runtime.normalizeLiveRuntimeSnapshot(raw, '1'), /provenance|TEST navigation/);
    const point = compactPoint();
    point.source = bad;
    assert.throws(() => history.normalizeLiveRuntimeHistoryPayload({
      schemaVersion: history.LIVE_RUNTIME_HISTORY_SCHEMA_VERSION, serverId: '1', points: [point],
    }, '1'), /provenance|TEST navigation/);
  }
});

test('a same-time unmarked history bootstrap may not overwrite an observed TEST frame', () => {
  history.applyLiveRuntimeHistory('1', [compactPoint()]);
  const unmarked = compactPoint();
  delete unmarked.source;
  assert.throws(() => history.applyLiveRuntimeHistory('1', [unmarked]), /cannot replace TEST navigation/);
  assert.deepEqual(history.getLiveRuntimeHistory('1')[0].source, marker);
});

test('ordinary Core scores without a TEST marker are not mislabeled as synthetic navigation', () => {
  const raw = coreSnapshot();
  raw.source = { kind: 'python-core', health: 'healthy' };
  const observed = runtime.normalizeLiveRuntimeSnapshot(raw, '1');
  assert.equal(observed.source.syntheticNavigation, undefined);
  history.appendLiveRuntimeHistory(observed);
  assert.equal(history.getLiveRuntimeHistory('1')[0].source, undefined);
});
