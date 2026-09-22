import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const trace = await vite.ssrLoadModule('/lib/score-trace.ts');
const evidence = await vite.ssrLoadModule('/lib/live-map-evidence.ts');
const shared = await vite.ssrLoadModule('/lib/operator-shared-window.ts');

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
  const timeline = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');
  const operator = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(source, /עקבה נצפית/);
  assert.match(source, /נתיב מזוהה/);
  assert.match(source, /קבוצות/);
  assert.match(source, /תבנית/);
  assert.deepEqual([...shared.OPERATOR_SHARED_WINDOWS], [30, 60, 90]);
  assert.match(source, /data-testid="operator-shared-time-window"/);
  assert.match(source, /setOperatorWindowForServer\(serverId, minutes\)/);
  assert.match(source, /subscribeOperatorWindow\(serverId, setTraceWindowMinutes\)/);
  assert.match(timeline, /subscribeOperatorWindow\(serverId, setWindowMinutes\)/);
  assert.equal((source.match(/aria-label="חלון זמן משותף למפה ולגרף"/g) ?? []).length, 1);
  assert.doesNotMatch(timeline, /aria-label="חלון זמן לפי נתוני Core"/);
  assert.match(source, /getRuntimeTrace\(serverId, 90\)/);
  assert.match(source, /selectedRuntimeGroup\?\.detectedRoutes/);
  assert.match(source, /\/api\/investigation\/recompute/);
  assert.match(source, /normalizeEventRecompute/);
  assert.match(source, /extractLiveMapEventEvidence/);
  assert.match(source, /route\.centerline/);
  assert.doesNotMatch(source, /buildSoSmileGeometry/);
  assert.doesNotMatch(source, /getServerScenario/);
  assert.match(source, /runtimeGroups\.filter\(\(group\) => group\.family === "SI"\)/);
  assert.match(source, /data-testid="so-adjacent-relations"/);
  assert.match(source, /soTemplate\.values\[index\]/);
  assert.doesNotMatch(operator, /className="v04-map-toolbar"/);
});

test('OP-02 SIM exposes observed trace, score trace, route, group and template layers with one shared 30/60/90 control', async () => {
  const map = await readFile('components/bluewolf/so-governed-visuals.tsx', 'utf8');
  const operator = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(map, /SIM_TRACE_RETENTION_MINUTES = 90/);
  assert.match(map, /observedLayer/);
  assert.match(map, /routeLayer/);
  assert.match(map, /groupLayer/);
  assert.match(map, /scoreTraceLayer && <g className="score-trace"/);
  assert.match(map, /relationLayer && selectedGroup === "so"/);
  assert.match(map, /relationLayer && selectedGroup === "si"/);
  assert.match(map, /operatorWindowForServer\(serverId\)/);
  assert.doesNotMatch(map, /SIM_TRACE_WINDOWS\.map/);
  assert.match(operator, /showRelations=\{showRelations\}/);
  assert.match(operator, /showTrace=\{showTrace\}/);
});
