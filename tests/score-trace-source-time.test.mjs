import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const trace = await vite.ssrLoadModule('/lib/score-trace.ts');

const base = Date.parse('2026-09-20T09:00:00.000Z');
const fix = (seconds, override = {}) => ({
  timeMs: base + seconds * 1000, groupId: 'g1', eventId: 'e1', vehicleId: 42,
  latitude: 32.0, longitude: 34.8, sync: 75, ...override,
});

test('OP-02 late Core samples do not rewind a 30-minute trace window', () => {
  const newest = fix(3600);
  const late = fix(120);
  const retained = trace.filterTraceWindow([newest, late, fix(360, { vehicleId: 43 })], 30);
  assert.deepEqual(retained, [newest]);
  assert.deepEqual(trace.filterTraceWindow([late, newest], 30), [newest]);
});

test('OP-02 rejects impossible or nonfinite WGS84 fixes before map projection and retention', () => {
  const valid = fix(0);
  const impossible = [
    fix(1, { latitude: 90.01 }), fix(2, { latitude: -90.01 }),
    fix(3, { longitude: 180.01 }), fix(4, { longitude: -180.01 }),
    fix(5, { latitude: Number.NaN }), fix(6, { timeMs: Number.POSITIVE_INFINITY }),
  ];
  const raw = structuredClone(valid);
  const retained = trace.mergeScoreTrace([impossible[0], valid], impossible.slice(1));
  assert.deepEqual(valid, raw, 'invalid navigation cannot mutate the original valid fix');
  assert.deepEqual(retained, [{ ...valid, breakAfter: true }],
    'retain only the real fix; invalid later navigation must terminate its displayed line');
  assert.deepEqual(trace.filterTraceWindow(retained, 30), retained);
  assert.deepEqual(trace.filterTraceWindow([impossible[0], valid, impossible[1]], 30), [valid]);
  assert.deepEqual(trace.traceSegments([valid, ...impossible]), []);
});

test('OP-02 out-of-order trace points sort by source timestamp and never join event transitions', () => {
  const first = fix(0);
  const second = fix(5);
  const newEvent = fix(9, { eventId: 'e2' });
  const later = fix(12, { eventId: 'e2' });
  assert.deepEqual(trace.traceSegments([later, newEvent, second, first]), [[first, second], [newEvent, later]]);
});

test('OP-02 invalid observed fix breaks a scored route segment instead of joining across the hole', () => {
  const before = fix(0);
  const missing = fix(4, { latitude: 100 });
  const after = fix(8);
  assert.deepEqual(trace.traceSegments([before, missing, after]), []);
});
