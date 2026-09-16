import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const trace = await vite.ssrLoadModule('/lib/score-trace.ts');
const evidence = await vite.ssrLoadModule('/lib/live-map-evidence.ts');

test('OP-02 trace retention supports 30/60/90 minute display windows by source time', () => {
  assert.equal(trace.DEFAULT_TRACE_WINDOW_MINUTES, 30);
  assert.equal(trace.TRACE_RETENTION_MINUTES, 90);
  const end = Date.parse('2026-09-16T06:30:00Z');
  const points = [95, 89, 60, 29, 0].map((minutesAgo, index) => ({
    timeMs: end - minutesAgo * 60_000,
    groupId: 'g1', eventId: 'e1', vehicleId: 1,
    latitude: 32 + index * 0.001, longitude: 34.8, sync: 80,
  }));
  assert.equal(trace.filterTraceWindow(points, 30).length, 2);
  assert.equal(trace.filterTraceWindow(points, 60).length, 3);
  assert.equal(trace.filterTraceWindow(points, 90).length, 4);
});

test('OP-02 trace segments never bridge event, group or >10s gaps', () => {
  const base = Date.parse('2026-09-16T06:00:00Z');
  const points = [
    { timeMs: base, groupId: 'g1', eventId: 'e1', vehicleId: 1, latitude: 32, longitude: 34.8, sync: 80 },
    { timeMs: base + 5_000, groupId: 'g1', eventId: 'e1', vehicleId: 1, latitude: 32.001, longitude: 34.8, sync: 70 },
    { timeMs: base + 10_000, groupId: 'g1', eventId: 'e2', vehicleId: 1, latitude: 32.002, longitude: 34.8, sync: 60 },
    { timeMs: base + 30_000, groupId: 'g1', eventId: 'e2', vehicleId: 1, latitude: 32.003, longitude: 34.8, sync: 50 },
  ];
  assert.equal(trace.traceSegments(points).length, 1);
});

test('OP-02 map template assignment is joined through Core navigation vehicle identifier', () => {
  const result = {
    eventId: 'e1', templateId: 'tpl', routes: [{ routeInstanceId: 'r1' }],
    points: [{ members: [{ memberId: 'member-a', routeInstanceId: 'r1', slotId: 'slot-2', expectedPhase: .25 }], navigation: [{ memberId: 'member-a', vehicleIdentifier: 42 }] }],
  };
  const mapped = evidence.extractLiveMapEventEvidence(result);
  assert.equal(mapped.assignments[0].vehicleIdentifier, 42);
  assert.equal(mapped.assignments[0].slotId, 'slot-2');
  assert.equal(mapped.assignments[0].expectedPhase, .25);
});

test('OP-02 Core map exposes independent truth layers and uses Core evidence, never demo route synthesis', async () => {
  const source = await readFile('components/bluewolf/operational-live-map.tsx', 'utf8');
  assert.match(source, /עקבה נצפית/);
  assert.match(source, /נתיב מזוהה/);
  assert.match(source, /קבוצות/);
  assert.match(source, /תבנית/);
  assert.match(source, /TRACE_WINDOWS = \[30, 60, 90\]/);
  assert.match(source, /getRuntimeTrace\(serverId, TRACE_WINDOWS\.at\(-1\) \?\? 90\)/);
  assert.match(source, /selectedRuntimeGroup\?\.detectedRoutes/);
  assert.match(source, /\/api\/investigation\/recompute/);
  assert.match(source, /normalizeEventRecompute/);
  assert.match(source, /extractLiveMapEventEvidence/);
  assert.match(source, /route\.centerline/);
  assert.doesNotMatch(source, /buildSoSmileGeometry/);
  assert.doesNotMatch(source, /getServerScenario/);
});
