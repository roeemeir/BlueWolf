import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const runtime = await vite.ssrLoadModule('/lib/live-runtime.ts');
const { traceSegments } = await vite.ssrLoadModule('/lib/score-trace.ts');
const start = Date.parse('2026-09-22T04:00:00.000Z');

function snapshot(serverId, second, positionedIds) {
  const observedAt = new Date(start + second * 1000).toISOString();
  const original = runtime.simulationRuntimeSnapshot(serverId, observedAt);
  const group = original.groupList.find((item) => item.key === 'si');
  assert.ok(group?.members.length, 'simulation baseline must supply a valid vehicle contract');
  const templateVehicle = group.members[0];
  group.members = [401, 402].map((vehicleId) => {
    const positioned = positionedIds.includes(vehicleId);
    return {
      ...templateVehicle, id: vehicleId,
      latitude: positioned ? 32 + vehicleId / 10000 + second / 100_000 : undefined,
      longitude: positioned ? 34.8 : undefined,
      sync: 80, scoreValid: true,
    };
  });
  original.source = { kind: 'python-core', health: 'healthy' };
  original.groupList = [group];
  original.groups = { si: group };
  return original;
}

const intervals = (serverId, vehicleId) => traceSegments(runtime.getRuntimeTrace(serverId, 30))
  .filter(([first]) => first.vehicleId === vehicleId)
  .map(([first, last]) => [(first.timeMs - start) / 1000, (last.timeMs - start) / 1000]);

test('OP-02 actual runtime collector does not draw across a per-vehicle missing WGS84 fix', () => {
  const serverId = '1';
  try {
    runtime.restoreSimulationScenario(serverId);
    runtime.applyLiveRuntimeSnapshot(snapshot(serverId, 0, [401, 402]));
    runtime.applyLiveRuntimeSnapshot(snapshot(serverId, 2, [401])); // no coordinates for vehicle 402
    runtime.applyLiveRuntimeSnapshot(snapshot(serverId, 4, [401, 402]));
    assert.deepEqual(intervals(serverId, 401), [[0, 2], [2, 4]]);
    assert.deepEqual(intervals(serverId, 402), []);
    assert.equal(runtime.getRuntimeTrace(serverId).filter((point) => point.vehicleId === 402).length, 2);
  } finally {
    runtime.restoreSimulationScenario(serverId);
  }
});

test('OP-02 positionless runtime snapshot ends previous line without adding synthetic navigation', () => {
  const serverId = '2';
  try {
    runtime.restoreSimulationScenario(serverId);
    runtime.applyLiveRuntimeSnapshot(snapshot(serverId, 0, [401]));
    runtime.applyLiveRuntimeSnapshot(snapshot(serverId, 2, []));
    runtime.applyLiveRuntimeSnapshot(snapshot(serverId, 4, [401]));
    assert.deepEqual(intervals(serverId, 401), []);
    assert.equal(runtime.getRuntimeTrace(serverId).length, 2);
  } finally {
    runtime.restoreSimulationScenario(serverId);
  }
});

test('OP-02 missing fix on one server cannot disconnect identically numbered vehicle on another', () => {
  try {
    runtime.restoreSimulationScenario('1');
    runtime.restoreSimulationScenario('3');
    for (const second of [0, 2, 4]) {
      runtime.applyLiveRuntimeSnapshot(snapshot('1', second, second === 2 ? [401] : [401, 402]));
      runtime.applyLiveRuntimeSnapshot(snapshot('3', second, [401, 402]));
    }
    assert.deepEqual(intervals('1', 402), []);
    assert.deepEqual(intervals('3', 402), [[0, 2], [2, 4]]);
  } finally {
    runtime.restoreSimulationScenario('1');
    runtime.restoreSimulationScenario('3');
  }
});
