import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { mergeScoreTrace, filterTraceWindow, traceSegments } = await vite.ssrLoadModule('/lib/score-trace.ts');

const fix = (second, vehicleId, extra = {}) => ({
  timeMs: Date.parse('2026-09-22T04:00:00.000Z') + second * 1000,
  vehicleId, groupId: 'group-1', eventId: 'event-1',
  latitude: 32 + vehicleId / 1000 + second / 100_000,
  longitude: 34, sync: 80, ...extra,
});

const lineTimes = (points) => traceSegments(filterTraceWindow(points)).map(([first, second]) => [first.vehicleId, (first.timeMs - fix(0, 1).timeMs) / 1000, (second.timeMs - fix(0, 1).timeMs) / 1000]);

test('OP-02 missing vehicle fix omitted upstream breaks only its own scored line within ten seconds', () => {
  const initial = [fix(0, 1), fix(0, 2)];
  const raw = structuredClone(initial);
  let trace = mergeScoreTrace([], initial);
  trace = mergeScoreTrace(trace, [fix(2, 1)]); // vehicle 2 has NO coordinate row in this snapshot
  trace = mergeScoreTrace(trace, [fix(4, 1), fix(4, 2)]);
  assert.deepEqual(initial, raw, 'source fixes must not be mutated');
  assert.deepEqual(lineTimes(trace), [[1, 0, 2], [1, 2, 4]]);
  assert.equal(trace.find((point) => point.vehicleId === 2 && point.timeMs === fix(0, 2).timeMs)?.breakAfter, true);
});

test('OP-02 entirely positionless snapshot does not connect previously observed fixes on recovery', () => {
  let trace = mergeScoreTrace([], [fix(0, 7)]);
  trace = mergeScoreTrace(trace, []); // a real applied runtime snapshot with no observed positions
  trace = mergeScoreTrace(trace, [fix(2, 7)]);
  assert.deepEqual(lineTimes(trace), []);
  assert.equal(trace.length, 2, 'retain both real observations without inventing an intermediate fix');
});

test('OP-02 invalid incoming GPS is rejected but still ends previous line before recovery', () => {
  let trace = mergeScoreTrace([], [fix(0, 5)]);
  trace = mergeScoreTrace(trace, [fix(1, 5, { latitude: Number.NaN })]);
  trace = mergeScoreTrace(trace, [fix(2, 5)]);
  assert.deepEqual(lineTimes(trace), []);
  assert.equal(trace.length, 2, 'no invalid position may reach map projection');
});

test('OP-02 duplicate source-time updates cannot erase a previously observed gap', () => {
  let trace = mergeScoreTrace([], [fix(0, 1), fix(0, 2)]);
  trace = mergeScoreTrace(trace, [fix(2, 1)]);
  trace = mergeScoreTrace(trace, [fix(0, 2)]); // late replay of the old valid fix
  trace = mergeScoreTrace(trace, [fix(4, 2)]);
  assert.deepEqual(lineTimes(trace).filter(([vehicle]) => vehicle === 2), []);
});

test('OP-02 normal continuous input and independent server traces remain continuous', () => {
  const firstServer = mergeScoreTrace(mergeScoreTrace([], [fix(0, 1), fix(0, 2)]), [fix(2, 1)]);
  const secondServer = mergeScoreTrace(mergeScoreTrace([], [fix(0, 2)]), [fix(2, 2)]);
  assert.deepEqual(lineTimes(secondServer), [[2, 0, 2]], 'absence on one server must not alter another server');
  assert.deepEqual(lineTimes(firstServer), [[1, 0, 2]]);
});
