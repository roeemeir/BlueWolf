import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { traceWithEventRecompute } = await vite.ssrLoadModule('/lib/operator-retroactive-result.ts');
const { traceSegments } = await vite.ssrLoadModule('/lib/score-trace.ts');
const start = Date.parse('2026-09-22T04:00:00.000Z');
const navigation = (id, latitude = 32 + id / 10_000) => ({
  memberId: `member-${id}`, vehicleIdentifier: id,
  latitude, longitude: latitude === null ? null : 34.8,
});
const frame = (second, rows) => ({
  observedAt: new Date(start + second * 1000).toISOString(),
  members: rows.map((row) => ({ memberId: row.memberId, sync: 65 })),
  navigation: rows,
});
const recompute = (points) => ({ groupId: 'g', eventId: 'e', points });
const intervals = (rows, id) => traceSegments(rows).filter(([first]) => first.vehicleId === id)
  .map(([first, last]) => [(first.timeMs - start) / 1000, (last.timeMs - start) / 1000]);

test('OP-04 archive recompute retains actual fixes but breaks a single vehicle at an explicit null observation', () => {
  const result = recompute([
    frame(0, [navigation(11), navigation(12)]),
    frame(2, [navigation(11), navigation(12, null)]),
    frame(4, [navigation(11), navigation(12)]),
  ]);
  const raw = structuredClone(result);
  const rows = traceWithEventRecompute([], result);
  assert.deepEqual(result, raw, 'recompute evidence must remain unmodified');
  assert.equal(rows.length, 5, 'null navigation is not a position on the map');
  assert.deepEqual(intervals(rows, 11), [[0, 2], [2, 4]]);
  assert.deepEqual(intervals(rows, 12), []);
});

test('OP-04 a completely absent navigation frame breaks all prior observed lines even if frames arrive reordered', () => {
  const rows = traceWithEventRecompute([], recompute([
    frame(4, [navigation(21)]),
    frame(0, [navigation(21)]),
    frame(2, []),
  ]));
  assert.equal(rows.length, 2);
  assert.deepEqual(intervals(rows, 21), []);
});

test('OP-04 an impossible WGS84 recompute fix never projects or bridges a preceding valid fix', () => {
  const rows = traceWithEventRecompute([], recompute([
    frame(0, [navigation(23)]),
    frame(2, [navigation(23, 95)]),
    frame(4, [navigation(23)]),
  ]));
  assert.equal(rows.length, 2);
  assert.deepEqual(intervals(rows, 23), []);
});

test('OP-04 group/event-scoped replacement keeps unrelated prior source observations untouched', () => {
  const other = { timeMs: start, groupId: 'other', eventId: 'e', vehicleId: 40, latitude: 32, longitude: 34, sync: 75 };
  const oldSelected = { ...other, groupId: 'g', vehicleId: 41 };
  const prior = [other, oldSelected];
  const original = structuredClone(prior);
  const rows = traceWithEventRecompute(prior, recompute([frame(0, [navigation(41)])]));
  assert.deepEqual(prior, original);
  assert.ok(rows.some((row) => row === other));
  assert.ok(!rows.includes(oldSelected));
  assert.equal(rows.filter((row) => row.groupId === 'g').length, 1);
});
