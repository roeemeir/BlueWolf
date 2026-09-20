import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { nearestHistoryPoint, resolveOperatorCursorFrame, traceUpToCursor } = await vite.ssrLoadModule('/lib/operator-time-cursor.ts');

const p0 = '2026-09-16T12:00:00.000Z';
const p1 = '2026-09-16T12:00:03.000Z';
const history = [
  { schemaVersion: 'bluewolf.live-runtime-history.v1', serverId: '1', observedAt: p0, groups: [{ id: 'g1', name: 'G1', color: '#111', total: 80, sync: 81, route: 79, scoreValid: true, event: { id: 'e1', active: true } }] },
  { schemaVersion: 'bluewolf.live-runtime-history.v1', serverId: '1', observedAt: p1, groups: [{ id: 'g1', name: 'G1', color: '#111', total: 62, sync: 60, route: 66, scoreValid: true, event: { id: 'e2', active: true } }] },
];
const trace = [
  { timeMs: Date.parse(p0), groupId: 'g1', eventId: 'e1', vehicleId: 10, latitude: 32, longitude: 34.8, sync: 82 },
  { timeMs: Date.parse(p0) + 1000, groupId: 'g1', eventId: 'e9', vehicleId: 20, latitude: 33, longitude: 35.8, sync: 10 },
  { timeMs: Date.parse(p1), groupId: 'g1', eventId: 'e2', vehicleId: 10, latitude: 32.001, longitude: 34.801, sync: 61 },
  { timeMs: Date.parse(p1) + 2000, groupId: 'g2', eventId: 'e2', vehicleId: 30, latitude: 31, longitude: 33, sync: 50 },
];

test('BW-UI-005 resolves score point and WGS84 vehicle trace at one evidence timestamp', () => {
  const frame = resolveOperatorCursorFrame(history, trace, p0);
  assert.ok(frame);
  assert.equal(frame.observedAt, p0);
  assert.equal(frame.groups[0].sync, 81);
  assert.deepEqual(frame.vehicles.map((item) => item.vehicleId), [10]);
  assert.equal(frame.vehicles[0].latitude, 32);
  assert.equal(frame.vehicles[0].sync, 82);
});

test('cursor join never crosses event/group boundaries even within tolerance', () => {
  const frame = resolveOperatorCursorFrame(history, trace, p1);
  assert.ok(frame);
  assert.deepEqual(frame.vehicles.map((item) => item.vehicleId), [10]);
  assert.equal(frame.vehicles[0].eventId, 'e2');
});

test('cursor lookup is fail-closed outside tolerance and trace clips future points', () => {
  assert.equal(nearestHistoryPoint(history, '2026-09-16T12:01:00.000Z'), null);
  assert.deepEqual(traceUpToCursor(trace, Date.parse(p0)).map((item) => item.timeMs), [Date.parse(p0)]);
});

test('BW-UI-005 historical map never puts a future fix on an earlier score frame', () => {
  const at = Date.parse(p0);
  const earlier = { ...trace[0], vehicleId: 40, timeMs: at - 8000, latitude: 32.1 };
  const futureCloser = { ...trace[0], vehicleId: 40, timeMs: at + 1000, latitude: 33.9 };
  const futureOnly = { ...trace[0], vehicleId: 50, timeMs: at + 500, latitude: 34.1 };
  const frame = resolveOperatorCursorFrame(history, [futureOnly, futureCloser, earlier], p0);
  assert.ok(frame);
  assert.deepEqual(frame.vehicles.map((row) => row.vehicleId), [40]);
  assert.equal(frame.vehicles[0].latitude, 32.1);
  assert.equal(frame.vehicles[0].timeMs, earlier.timeMs);
  assert.ok(frame.vehicles.every((row) => row.timeMs <= frame.timeMs));
});

test('BW-UI-005 rejects invalid WGS84 and chooses the newest valid past fix without relying on arrival order', () => {
  const at = Date.parse(p0);
  const stale = { ...trace[0], timeMs: at - 9000, latitude: 31.9 };
  const recent = { ...trace[0], timeMs: at - 2000, latitude: 32.2 };
  const invalid = { ...trace[0], vehicleId: 71, latitude: 91, timeMs: at };
  const badLongitude = { ...trace[0], vehicleId: 72, longitude: Number.POSITIVE_INFINITY, timeMs: at };
  const frame = resolveOperatorCursorFrame(history, [recent, invalid, stale, badLongitude], p0);
  assert.ok(frame);
  assert.deepEqual(frame.vehicles.map((row) => row.vehicleId), [10]);
  assert.equal(frame.vehicles[0].latitude, 32.2);
  assert.equal(frame.vehicles[0].timeMs, recent.timeMs);
  assert.deepEqual(traceUpToCursor(trace, Number.NaN), []);
  assert.deepEqual(traceUpToCursor(trace, null), trace);
});
