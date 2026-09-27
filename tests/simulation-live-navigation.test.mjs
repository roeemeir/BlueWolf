import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { simulationObservedFix } = await vite.ssrLoadModule('/lib/simulation-live-navigation.ts');
const ideal = { x: 300, y: 200, heading: 45 };
const sample = (serverId, vehicleId, tick) => simulationObservedFix({ serverId, vehicleId, tick, ideal });

test('BW-CR-006 SIM observed fixes are deterministic yet distinct from the ideal template', () => {
  const a = sample('1', 42, 100);
  assert.deepEqual(a, sample('1', 42, 100));
  assert.equal(a?.source, 'synthetic-sim-navigation');
  assert.ok(a && Math.hypot(a.x - ideal.x, a.y - ideal.y) > 0.2);
});

test('BW-CR-005 same tick and vehicle have different observations across the three servers', () => {
  const fixes = [1, 2, 3].map((server) => sample(String(server), 42, 100));
  assert.ok(fixes.every(Boolean));
  assert.equal(new Set(fixes.map((fix) => `${fix.x.toFixed(5)}:${fix.y.toFixed(5)}`)).size, 3);
});

test('BW-CR-006 30-second outage returns actual missing positions rather than interpolated fixes', () => {
  const fixes = Array.from({ length: 2000 }, (_, tick) => sample('1', 42, tick));
  const hole = fixes.findIndex((fix, index) => !fix && fixes[index - 1] && fixes[index + 1] === null);
  assert.ok(hole > 0, 'at least one deterministic outage must begin after a valid observation');
  assert.equal(fixes[hole], null);
  assert.equal(fixes[hole + 1], null);
  assert.ok(fixes[hole - 1] && fixes[hole + 6], 'navigation resumes after a bounded explicit gap');
});

test('BW-CR-006 synthetic navigation rejects invalid source identifiers and nonfinite template positions', () => {
  assert.equal(sample('4', 42, 100), null);
  assert.equal(sample('1', 42, -1), null);
  assert.equal(simulationObservedFix({ serverId: '1', vehicleId: 42, tick: 100, ideal: { ...ideal, x: NaN } }), null);
});
