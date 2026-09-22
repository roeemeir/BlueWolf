import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { newerRuntimeSnapshotTime, createRuntimePollOrder } = await vite.ssrLoadModule('/lib/runtime-snapshot-order.ts');
const iso = (second) => new Date(Date.parse('2026-09-22T04:00:00.000Z') + second * 1000).toISOString();

test('OP-02 whole Core snapshots advance only with strictly newer observed source time', () => {
  let latest = Number.NEGATIVE_INFINITY;
  const arrivals = [0, 4, 2, 4, 3, 6, 1, 6];
  const expected = [0, 4, 4, 4, 4, 6, 6, 6];
  arrivals.forEach((second, index) => {
    const accepted = newerRuntimeSnapshotTime(latest, iso(second));
    if (accepted !== null) latest = accepted;
    assert.equal(latest, Date.parse(iso(expected[index])));
  });
});

test('OP-02 duplicate and malformed whole snapshots cannot be treated as fresh navigation', () => {
  const newest = Date.parse(iso(12));
  assert.equal(newerRuntimeSnapshotTime(newest, iso(12)), null);
  assert.equal(newerRuntimeSnapshotTime(newest, iso(2)), null);
  assert.throws(() => newerRuntimeSnapshotTime(newest, 'not-a-time'), /invalid Core runtime snapshot observedAt/);
  assert.throws(() => newerRuntimeSnapshotTime(newest, ''), /invalid Core runtime snapshot observedAt/);
  assert.equal(newerRuntimeSnapshotTime(newest, iso(14)), Date.parse(iso(14)));
});

test('OP-02 changing refresh cadence cannot reset an existing Core source-time watermark', () => {
  const order = createRuntimePollOrder();
  const beforeRefresh = order.begin('1');
  assert.equal(order.acceptSnapshot('1', beforeRefresh, iso(30)), true);
  // React effect is replaced, but the mounted app keeps this order instance.
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(20)), false);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(30)), false);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(31)), true);
});

test('OP-02 later completed success cannot be cleared by an earlier failed request', () => {
  const order = createRuntimePollOrder();
  const older = order.begin('1');
  const newer = order.begin('1');
  assert.equal(order.acceptSnapshot('1', newer, iso(6)), true);
  assert.equal(order.acceptFailure('1', older), false);
});

test('OP-02 later completed network failure is not replaced by an earlier delayed success', () => {
  const order = createRuntimePollOrder();
  const older = order.begin('1');
  const newer = order.begin('1');
  assert.equal(order.acceptFailure('1', newer), true);
  assert.equal(order.acceptSnapshot('1', older, iso(6)), false);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(6)), true);
});

test('OP-02 server switches preserve separate watermarks and outstanding request order', () => {
  const order = createRuntimePollOrder();
  const first = order.begin('1');
  const second = order.begin('2');
  assert.equal(order.acceptSnapshot('1', first, iso(30)), true);
  assert.equal(order.acceptSnapshot('2', second, iso(3)), true);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(4)), false);
  assert.equal(order.acceptSnapshot('2', order.begin('2'), iso(4)), true);
});

test('OP-02 malformed source timestamp causes a contract failure and cannot advance the watermark', () => {
  const order = createRuntimePollOrder();
  const malformed = order.begin('1');
  assert.throws(() => order.acceptSnapshot('1', malformed, 'not-a-time'), /invalid Core runtime snapshot observedAt/);
  assert.equal(order.acceptFailure('1', malformed), true);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(1)), true);
});

test('OP-02 dashboard gates navigation, health, cards and HTTP errors before mutation', () => {
  const dashboard = readFileSync(new URL('../components/bluewolf/dashboard-app.tsx', import.meta.url), 'utf8');
  const block = dashboard.slice(dashboard.indexOf('const poll = async () => {'), dashboard.indexOf('void bootstrapHistory();'));
  const begin = block.indexOf('const requestId = pollOrder.current.begin(serverValue);');
  const evidenceGate = block.indexOf('pollOrder.current.acceptSnapshot(serverValue, requestId, snapshot.observedAt)');
  const healthGate = block.indexOf('pollOrder.current.acceptHealthSnapshot(serverValue, requestId, snapshot.observedAt)');
  const gate = block.indexOf('if (!accepted) return;');
  const trace = block.indexOf('applyLiveRuntimeSnapshot(snapshot);');
  const history = block.indexOf('appendLiveRuntimeHistory(snapshot);');
  const healthFallback = block.indexOf('applyLiveRuntimeSnapshot(unavailableRuntimeSnapshot(serverValue, snapshot.source.detail');
  const cards = block.indexOf('setCoreSnapshot(healthyCoreFrame ? snapshot : null);');
  const failed = block.indexOf('if (cancelled || !pollOrder.current.acceptFailure(serverValue, requestId)) return;');
  const unavailable = block.indexOf('applyLiveRuntimeSnapshot(unavailableRuntimeSnapshot(serverValue, detail));');
  assert.ok(begin !== -1 && begin < evidenceGate && evidenceGate < healthGate && healthGate < gate && gate < trace && trace < history && history < healthFallback && healthFallback < cards);
  assert.ok(failed !== -1 && failed < unavailable);
  assert.match(dashboard, /if \(healthyCoreFrame\) \{\s*applyLiveRuntimeSnapshot\(snapshot\);\s*appendLiveRuntimeHistory\(snapshot\);/);
  assert.match(dashboard, /const pollOrder = useRef\(createRuntimePollOrder\(\)\);/);
  assert.match(dashboard, /return \(\) => \{ cancelled = true; window\.clearInterval\(timer\); \};/);
});
