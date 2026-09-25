import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { newerRuntimeSnapshotTime, createRuntimePollOrder } = await vite.ssrLoadModule('/lib/runtime-snapshot-order.ts');
const iso = (second) => new Date(Date.parse('2026-09-22T04:00:00.000Z') + second * 1000).toISOString();

test('OP-02 source timestamps require an explicit timezone and reject Date.parse ambiguous local/locale inputs', () => {
  const recent = Date.parse(iso(0));
  for (const ambiguous of ['2026-09-22T04:00:01', '09/22/2026 04:00:01', '0', '2026-09-22', '2026-09-22 04:00:01Z']) {
    assert.ok(Number.isFinite(Date.parse(ambiguous)) || ambiguous === '2026-09-22 04:00:01Z', `expected a meaningful negative case: ${ambiguous}`);
    assert.throws(() => newerRuntimeSnapshotTime(recent, ambiguous), /invalid Core runtime snapshot observedAt/, ambiguous);
  }
});

test('OP-02 source timestamp rejects impossible calendar and clock values instead of Date.parse normalization', () => {
  const latest = Number.NEGATIVE_INFINITY;
  for (const invalid of ['2026-02-31T04:00:00Z', '2026-02-29T04:00:00Z', '2026-09-31T04:00:00Z', '2026-13-01T04:00:00Z', '2026-09-22T24:00:00Z', '2026-09-22T04:60:00Z', '2026-09-22T04:00:60Z', '2026-09-22T04:00:00+24:00', '2026-09-22T04:00:00+03:60']) {
    assert.throws(() => newerRuntimeSnapshotTime(latest, invalid), /invalid Core runtime snapshot observedAt/, invalid);
  }
  assert.equal(newerRuntimeSnapshotTime(latest, '2028-02-29T04:00:00Z'), Date.parse('2028-02-29T04:00:00Z'));
  assert.equal(newerRuntimeSnapshotTime(latest, '2026-09-22T07:00:00+03:00'), Date.parse(iso(0)));
  assert.equal(newerRuntimeSnapshotTime(latest, '2026-09-22T04:00:00.123456+00:00'), Date.parse('2026-09-22T04:00:00.123Z'));
});

test('OP-02 invalid source time fails closed without advancing a server watermark or corrupting another server', () => {
  const order = createRuntimePollOrder();
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(1)), true);
  const invalidRequest = order.begin('1');
  assert.throws(() => order.acceptSnapshot('1', invalidRequest, '2026-02-31T04:00:00Z'), /invalid Core runtime snapshot observedAt/);
  assert.equal(order.acceptFailure('1', invalidRequest), true);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(1)), false);
  assert.equal(order.acceptSnapshot('1', order.begin('1'), iso(2)), true);
  assert.equal(order.acceptSnapshot('2', order.begin('2'), iso(0)), true);
});
