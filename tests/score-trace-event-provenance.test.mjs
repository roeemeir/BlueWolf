import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const trace = await vite.ssrLoadModule('/lib/score-trace.ts');

const origin = Date.parse('2026-09-20T09:00:00.000Z');
const fix = (seconds, groupId = 'group-a', eventId = 'event-a', sync = 70) => ({
  timeMs: origin + seconds * 1000, groupId, eventId, vehicleId: 101,
  latitude: 32.01, longitude: 34.81, sync,
});

test('operator trace retains separate group/event evidence at the same source timestamp', () => {
  const first = fix(0);
  const concurrent = fix(0, 'group-b', 'event-b', 54);
  const merged = trace.mergeScoreTrace([first], [concurrent]);
  assert.equal(merged.length, 2, 'event transition must not overwrite the other source observation');
  assert.deepEqual(new Set(merged.map((row) => row.eventId)), new Set(['event-a', 'event-b']));
  assert.deepEqual(trace.mergeScoreTrace(merged, [fix(0, 'group-b', 'event-b', 52)]).map((row) => row.sync), [70, 52]);
});

test('operator map gives simultaneous event observations their own segments', () => {
  const a0 = fix(0), b0 = fix(0, 'group-b', 'event-b');
  const a5 = fix(5), b5 = fix(5, 'group-b', 'event-b');
  const segments = trace.traceSegments([b5, a5, b0, a0]);
  assert.equal(segments.length, 2);
  assert.ok(segments.every(([a, b]) => a.groupId === b.groupId && a.eventId === b.eventId));
  assert.deepEqual(new Set(segments.map(([a]) => a.eventId)), new Set(['event-a', 'event-b']));
});

test('operator map never revives an old event line across intervening membership', () => {
  const before = fix(0);
  const switched = fix(4, 'group-b', 'event-b');
  const returned = fix(8);
  assert.deepEqual(trace.traceSegments([before, switched, returned]), []);
});

test('operator map preserves a clean same-event segment and breaks at explicit invalid navigation', () => {
  const a0 = fix(0), a3 = fix(3), invalid = { ...fix(5), latitude: 120 }, a8 = fix(8);
  assert.deepEqual(trace.traceSegments([a8, a3, invalid, a0]), [[a0, a3]]);
});
