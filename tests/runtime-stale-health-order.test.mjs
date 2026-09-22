import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { createRuntimePollOrder } = await vite.ssrLoadModule('/lib/runtime-snapshot-order.ts');
const runtime = await vite.ssrLoadModule('/lib/live-runtime.ts');
const iso = (second) => new Date(Date.parse('2026-09-22T04:00:00.000Z') + second * 1000).toISOString();

function observedFrame(serverId, second) {
  const frame = runtime.simulationRuntimeSnapshot(serverId, iso(second));
  const group = frame.groupList.find((row) => row.key === 'si');
  assert.ok(group?.members.length);
  group.members = [{ ...group.members[0], id: 401, latitude: 32 + second / 100_000, longitude: 34.8, scoreValid: true, sync: 85 }];
  frame.groupList = [group];
  frame.groups = { si: group };
  frame.source = { kind: 'python-core', health: 'healthy' };
  return frame;
}

test('OP-02 repeated old source timestamp may update current stale health but cannot invent new score or GPS evidence', () => {
  const server = '1';
  const order = createRuntimePollOrder();
  try {
    runtime.restoreSimulationScenario(server);
    const first = observedFrame(server, 0);
    assert.equal(order.acceptSnapshot(server, order.begin(server), first.observedAt), true);
    runtime.applyLiveRuntimeSnapshot(first);
    const sourceTrace = structuredClone(runtime.getRuntimeTrace(server));
    const staleRequest = order.begin(server);
    assert.equal(order.acceptHealthSnapshot(server, staleRequest, first.observedAt), true);
    runtime.applyLiveRuntimeSnapshot(runtime.unavailableRuntimeSnapshot(server, 'Core stale', first.observedAt));
    assert.deepEqual(runtime.getRuntimeTrace(server), sourceTrace, 'health-only update must preserve last real fix');
    assert.ok(runtime.getRuntimeGroups(server).every((group) => !group.scoreValid), 'old scores must not remain marked operational');
    assert.equal(order.acceptSnapshot(server, order.begin(server), first.observedAt), false, 'unchanged source time is not new navigation');
    const recovery = observedFrame(server, 2);
    assert.equal(order.acceptSnapshot(server, order.begin(server), recovery.observedAt), true);
    runtime.applyLiveRuntimeSnapshot(recovery);
    assert.ok(runtime.getRuntimeGroups(server).some((group) => group.scoreValid));
    assert.equal(runtime.getRuntimeTrace(server).length, sourceTrace.length + 1);
  } finally {
    runtime.restoreSimulationScenario(server);
  }
});

test('OP-02 old delayed health failure cannot clear a newer accepted operational snapshot', () => {
  const order = createRuntimePollOrder();
  const delayedHealth = order.begin('1');
  const live = order.begin('1');
  assert.equal(order.acceptSnapshot('1', live, iso(10)), true);
  assert.equal(order.acceptHealthSnapshot('1', delayedHealth, iso(0)), false);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(10)), false);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(11)), true);
});

test('OP-02 current health-only response does not advance Core source time or affect another server', () => {
  const order = createRuntimePollOrder();
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(10)), true);
  assert.equal(order.acceptHealthSnapshot('1', order.begin('1'), iso(30)), true);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(11)), true, 'health-only frame is never navigation evidence');
  assert.equal(order.acceptSnapshot('2', order.begin('2'), iso(1)), true);
  const malformed = order.begin('1');
  assert.throws(() => order.acceptHealthSnapshot('1', malformed, '2026-02-31T04:00:00Z'), /invalid Core runtime snapshot observedAt/);
  assert.equal(order.acceptFailure('1', malformed), true);
  assert.equal(order.acceptSnapshot('2', order.begin('2'), iso(2)), true);
});
