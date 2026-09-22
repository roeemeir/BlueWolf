import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { newerRuntimeSnapshotTime } = await vite.ssrLoadModule('/lib/runtime-snapshot-order.ts');
const iso = (second) => new Date(Date.parse('2026-09-22T04:00:00.000Z') + second * 1000).toISOString();

test('OP-02 whole Core snapshots advance only with strictly newer observed source time', () => {
  let latest = Number.NEGATIVE_INFINITY;
  for (const second of [0, 4, 2, 4, 3, 6, 1, 6]) {
    const accepted = newerRuntimeSnapshotTime(latest, iso(second));
    if (accepted !== null) latest = accepted;
    assert.equal(latest, Date.parse(iso(Math.max(0, ...[0, 4, 2, 4, 3, 6, 1, 6].slice(0, [0, 4, 2, 4, 3, 6, 1, 6].indexOf(second) + 1)))));
  }
});

test('OP-02 duplicate and malformed whole snapshots cannot be treated as new missing navigation', () => {
  const newest = Date.parse(iso(12));
  assert.equal(newerRuntimeSnapshotTime(newest, iso(12)), null);
  assert.equal(newerRuntimeSnapshotTime(newest, iso(2)), null);
  assert.equal(newerRuntimeSnapshotTime(newest, 'not-a-time'), null);
  assert.equal(newerRuntimeSnapshotTime(newest, ''), null);
  assert.equal(newerRuntimeSnapshotTime(newest, iso(14)), Date.parse(iso(14)));
});

test('OP-02 each server/mode poll subscription owns an independent cursor', () => {
  const lastServer1 = Date.parse(iso(30));
  const lastServer2 = Date.parse(iso(3));
  assert.equal(newerRuntimeSnapshotTime(lastServer1, iso(4)), null);
  assert.equal(newerRuntimeSnapshotTime(lastServer2, iso(4)), Date.parse(iso(4)));
  assert.equal(newerRuntimeSnapshotTime(Number.NEGATIVE_INFINITY, iso(1)), Date.parse(iso(1)), 'a newly opened subscription may start at its own source time');
});

test('OP-02 dashboard rejects a whole stale poll BEFORE traces, cards, history and alerts change', () => {
  const dashboard = readFileSync(new URL('../components/bluewolf/dashboard-app.tsx', import.meta.url), 'utf8');
  const block = dashboard.slice(dashboard.indexOf('const poll = async () => {'), dashboard.indexOf('void bootstrapHistory();'));
  const gate = block.indexOf('const sourceTimeMs = newerRuntimeSnapshotTime(latestAcceptedSourceMs, snapshot.observedAt);');
  const reject = block.indexOf('if (sourceTimeMs === null) return;');
  const trace = block.indexOf('applyLiveRuntimeSnapshot(snapshot);');
  const history = block.indexOf('appendLiveRuntimeHistory(snapshot);');
  const cards = block.indexOf('setCoreSnapshot(snapshot.source.kind');
  assert.ok(gate !== -1 && gate < reject && reject < trace && trace < history && history < cards);
  assert.match(dashboard, /let latestAcceptedSourceMs = Number\.NEGATIVE_INFINITY/);
  assert.match(dashboard, /return \(\) => \{ cancelled = true; window\.clearInterval\(timer\); \};/);
});
