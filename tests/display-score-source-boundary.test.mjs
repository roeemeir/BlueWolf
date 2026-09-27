import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { smoothRuntimeHistoryForDisplay } = await vite.ssrLoadModule('/lib/display-score-smoothing.ts');

function point(second, total, syntheticNavigation) {
  return {
    schemaVersion: 'bluewolf.live-runtime-history.v1',
    serverId: '1',
    observedAt: `2026-09-24T10:00:${String(second).padStart(2, '0')}Z`,
    groups: [{ id: 'same-group', name: 'Same group', color: '#123456', total, sync: total, route: total, scoreValid: true, event: { id: 'same-event', active: true } }],
    ...(syntheticNavigation ? { source: { kind: 'python-core', navigationOrigin: 'simulation', syntheticNavigation: true } } : {}),
  };
}

test('TEST Core navigation and unmarked operational Core never share a display smoothing window even with identical server/group/event', () => {
  const history = [point(0, 80, true), point(5, 20, false), point(10, 40, false), point(15, 100, true), point(20, 60, true)];
  const untouched = structuredClone(history);
  const result = smoothRuntimeHistoryForDisplay(history, 30);

  assert.deepEqual(history, untouched, 'history and its original provenance must not be mutated');
  assert.equal(result[0].groups[0].total, 80);
  assert.equal(result[1].groups[0].total, 20, 'the first operational sample excludes the previous TEST score');
  assert.equal(result[2].groups[0].total, 30, 'consecutive operational samples still smooth within their own source');
  assert.equal(result[3].groups[0].total, 100, 'the first TEST sample excludes the previous operational score');
  assert.equal(result[4].groups[0].total, 80, 'consecutive TEST samples smooth within TEST origin only');
  assert.deepEqual(result.map((item) => item.source), history.map((item) => item.source));
  assert.equal(result[3].groups[0].sync, 100);
  assert.equal(result[3].groups[0].route, 100);
});

test('zero-second display window remains a detached, unsmoothed source-preserving view', () => {
  const history = [point(0, 80, true), point(5, 20, false)];
  const result = smoothRuntimeHistoryForDisplay(history, 0);
  assert.deepEqual(result, history);
  assert.notStrictEqual(result, history);
});
