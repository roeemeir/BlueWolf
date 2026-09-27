import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { mergeScoreTrace, traceSegments } = await vite.ssrLoadModule('/lib/score-trace.ts');
const origin = Date.parse('2026-09-22T04:00:00.000Z');
const fix = (seconds, groupId, eventId, override = {}) => ({
  timeMs: origin + seconds * 1000, groupId, eventId, vehicleId: 401,
  latitude: 32 + seconds / 100000, longitude: 34.8, sync: 80, ...override,
});
const simultaneous = (seconds) => [fix(seconds, 'si-a', 'event-a'), fix(seconds, 'si-b', 'event-b')];

function expectBothEventsBroken(points) {
  assert.deepEqual(points.filter((point) => point.vehicleId === 401 && point.timeMs === origin)
    .map((point) => [point.groupId, point.breakAfter]).sort(), [['si-a', true], ['si-b', true]]);
  assert.deepEqual(traceSegments(points).filter(([first]) => first.vehicleId === 401), []);
  assert.equal(points.filter((point) => point.vehicleId === 401).length, 4, 'both real endpoints of both events must be kept');
}

test('OP-02 missing vehicle fix severs every simultaneous group/event track, not just the first Map entry', () => {
  const atStart = mergeScoreTrace([], simultaneous(0));
  const duringGap = mergeScoreTrace(atStart, [fix(2, 'si-c', 'event-c', { vehicleId: 402 })]);
  expectBothEventsBroken(mergeScoreTrace(duringGap, simultaneous(4)));
});

test('OP-02 completely positionless snapshot severs both event tracks without inventing a fix', () => {
  const duringGap = mergeScoreTrace(mergeScoreTrace([], simultaneous(0)), []);
  expectBothEventsBroken(mergeScoreTrace(duringGap, simultaneous(4)));
});

test('OP-02 invalid WGS84 fix severs every simultaneous event track', () => {
  const duringGap = mergeScoreTrace(mergeScoreTrace([], simultaneous(0)), [fix(2, 'si-a', 'event-a', { latitude: 91 })]);
  expectBothEventsBroken(mergeScoreTrace(duringGap, simultaneous(4)));
});

test('OP-02 repeated valid rows cannot clear an established break on either event', () => {
  const duringGap = mergeScoreTrace(mergeScoreTrace([], simultaneous(0)), []);
  const repeated = mergeScoreTrace(duringGap, simultaneous(0));
  expectBothEventsBroken(mergeScoreTrace(repeated, simultaneous(4)));
});
