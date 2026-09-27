import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const runtime = await vite.ssrLoadModule('/lib/live-runtime.ts');
const { traceSegments } = await vite.ssrLoadModule('/lib/score-trace.ts');
const start = Date.parse('2026-09-22T04:00:00.000Z');
const timestamp = (seconds) => new Date(start + seconds * 1000).toISOString();

function healthySnapshot(serverId, seconds, hasFix = true) {
  const original = runtime.simulationRuntimeSnapshot(serverId, timestamp(seconds));
  const group = original.groupList.find((item) => item.key === 'si');
  assert.ok(group?.members.length);
  group.members = [{
    ...group.members[0],
    id: 401,
    latitude: hasFix ? 32 + seconds / 100_000 : undefined,
    longitude: hasFix ? 34.8 : undefined,
    sync: 80,
    scoreValid: true,
  }];
  original.source = { kind: 'python-core', health: 'healthy' };
  original.groups = { si: group };
  original.groupList = [group];
  return original;
}

const sourceSegments = (serverId) => traceSegments(runtime.getRuntimeTrace(serverId))
  .filter(([first]) => first.vehicleId === 401)
  .map(([first, last]) => [(first.timeMs - start) / 1000, (last.timeMs - start) / 1000]);

test('OP-02 HTTP failure clears operational status without inventing a source-observed GPS gap', () => {
  const serverId = '1';
  try {
    runtime.restoreSimulationScenario(serverId);
    runtime.applyLiveRuntimeSnapshot(healthySnapshot(serverId, 0));
    const genuineEvidence = structuredClone(runtime.getRuntimeTrace(serverId));
    runtime.applyLiveRuntimeSnapshot(runtime.unavailableRuntimeSnapshot(serverId, 'HTTP 503', timestamp(2)));
    assert.deepEqual(runtime.getRuntimeTrace(serverId), genuineEvidence, 'transport failure must not alter source navigation');
    assert.ok(runtime.getRuntimeGroups(serverId).every((group) => group.scoreValid === false));
    runtime.applyLiveRuntimeSnapshot(healthySnapshot(serverId, 4));
    assert.deepEqual(sourceSegments(serverId), [[0, 4]], 'recovery within source continuity limit may connect genuine fixes');
  } finally {
    runtime.restoreSimulationScenario(serverId);
  }
});

test('OP-02 stale/unavailable status never adds a synthetic fix or erases an already evidenced GPS gap', () => {
  const serverId = '2';
  try {
    runtime.restoreSimulationScenario(serverId);
    runtime.applyLiveRuntimeSnapshot(healthySnapshot(serverId, 0));
    const stale = healthySnapshot(serverId, 1);
    stale.source.health = 'stale';
    runtime.applyLiveRuntimeSnapshot(stale);
    assert.equal(runtime.getRuntimeTrace(serverId).length, 1, 'stale source must not contribute navigation');
    runtime.applyLiveRuntimeSnapshot(healthySnapshot(serverId, 2, false));
    const observedGapEvidence = structuredClone(runtime.getRuntimeTrace(serverId));
    assert.equal(observedGapEvidence[0].breakAfter, true, 'healthy but positionless source frame is real missing evidence');
    runtime.applyLiveRuntimeSnapshot(runtime.unavailableRuntimeSnapshot(serverId, 'network timeout', timestamp(3)));
    assert.deepEqual(runtime.getRuntimeTrace(serverId), observedGapEvidence, 'HTTP failure must preserve the real gap');
    runtime.applyLiveRuntimeSnapshot(healthySnapshot(serverId, 4));
    assert.deepEqual(sourceSegments(serverId), [], 'a real positionless frame still prevents a false continuous line');
  } finally {
    runtime.restoreSimulationScenario(serverId);
  }
});

test('OP-02 disconnected server cannot alter another server trace; long source gap is bounded by physical continuity', () => {
  try {
    runtime.restoreSimulationScenario('1');
    runtime.restoreSimulationScenario('3');
    for (const serverId of ['1', '3']) runtime.applyLiveRuntimeSnapshot(healthySnapshot(serverId, 0));
    runtime.applyLiveRuntimeSnapshot(runtime.unavailableRuntimeSnapshot('1', 'connection closed', timestamp(2)));
    runtime.applyLiveRuntimeSnapshot(healthySnapshot('3', 4));
    assert.deepEqual(sourceSegments('3'), [[0, 4]]);
    runtime.applyLiveRuntimeSnapshot(healthySnapshot('1', 12));
    assert.deepEqual(sourceSegments('1'), [], 'twelve seconds is larger than the ten-second observed-navigation limit');
    assert.deepEqual(sourceSegments('3'), [[0, 4]], 'identically numbered vehicles belong to independent server traces');
  } finally {
    runtime.restoreSimulationScenario('1');
    runtime.restoreSimulationScenario('3');
  }
});
