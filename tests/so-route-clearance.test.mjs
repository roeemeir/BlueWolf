import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { closedOutlineClearance } = await vite.ssrLoadModule('/lib/so-route-clearance.ts');
const { minimumRouteGap, buildSoSmileGeometry } = await vite.ssrLoadModule('/lib/so-geometry.ts');
const rectangle = (left, top, right, bottom) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

test('SO gap: crossing line segments return zero even though no sampled vertices touch', () => {
  const horizontal = rectangle(-5, -0.5, 5, 0.5);
  const vertical = rectangle(-0.5, -5, 0.5, 5);
  const sampledMinimum = Math.min(...horizontal.flatMap((a) => vertical.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
  assert.ok(sampledMinimum > 4, 'the old vertex-only algorithm would overlook this crossing');
  assert.equal(closedOutlineClearance(horizontal, vertical), 0);
  assert.equal(minimumRouteGap({ points: horizontal }, { points: vertical }), 0, 'the active SO geometry must use the continuous check');
});

test('SO gap: touching boundaries and completely contained polygons are not treated as clearance', () => {
  const outer = rectangle(-5, -5, 5, 5);
  const inner = rectangle(-1, -1, 1, 1);
  assert.equal(closedOutlineClearance(outer, inner), 0);
  assert.equal(closedOutlineClearance(inner, outer), 0);
  assert.equal(closedOutlineClearance(rectangle(0, 0, 1, 1), rectangle(1, 0, 2, 1)), 0);
});

test('SO gap: returns the perpendicular segment clearance, not a diagonal vertex distance', () => {
  const first = rectangle(0, 0, 4, 2);
  const second = rectangle(1, 2.25, 3, 4);
  assert.ok(Math.abs(closedOutlineClearance(first, second) - 0.25) < 1e-9);
  assert.ok(Math.abs(closedOutlineClearance(second, first) - 0.25) < 1e-9);
  assert.equal(closedOutlineClearance([], first), 0);
  assert.equal(closedOutlineClearance(first, [{ x: Number.NaN, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), 0);
});

test('SO gap: collapsed outlines are never reported as positively separated closed routes', () => {
  const valid = rectangle(10, 10, 14, 14);
  const collinear = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  const repeated = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  for (const collapsed of [collinear, repeated]) {
    assert.equal(closedOutlineClearance(collapsed, valid), 0);
    assert.equal(closedOutlineClearance(valid, collapsed), 0);
    assert.equal(minimumRouteGap({ points: collapsed }, { points: valid }), 0);
  }
  assert.ok(closedOutlineClearance(rectangle(0, 0, 2, 2), valid) > 0, 'valid disjoint outlines remain accepted');
});

test('SO generated mixed smile has positive continuous clearance between physical neighbors', () => {
  for (const chain of [['single', 'double', 'single'], ['double', 'single', 'double'], ['single', 'single', 'double', 'single']]) {
    const routes = buildSoSmileGeometry(chain, { centerX: 500, centerY: 260, spacing: 245, risePerStep: 22 });
    for (let index = 1; index < routes.length; index += 1) {
      assert.ok(minimumRouteGap(routes[index - 1], routes[index]) > 0, `${chain.join('-')}: neighboring outlines must not cross`);
    }
  }
});
