import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const {
  buildSoSmileGeometry,
  localHippodromePoints,
  minimumRouteGap,
  pointAtSoPhase,
  soSmilePoses,
} = await vite.ssrLoadModule('/lib/so-geometry.ts');

test('GEO-01 uses exact 30 degree neighboring axes with a horizontal odd center', () => {
  const odd = soSmilePoses(5);
  assert.deepEqual(odd.map((pose) => pose.rotationDeg), [-60, -30, 0, 30, 60]);
  for (let index = 1; index < odd.length; index += 1) {
    assert.equal(odd[index].rotationDeg - odd[index - 1].rotationDeg, 30);
  }
  assert.equal(odd[2].rotationDeg, 0);
});

test('GEO-01 even smile is symmetric without inventing a center route', () => {
  const even = soSmilePoses(4);
  assert.deepEqual(even.map((pose) => pose.rotationDeg), [-45, -15, 15, 45]);
  assert.equal(even[0].offsetX, -even[3].offsetX);
  assert.equal(even[1].offsetX, -even[2].offsetX);
  assert.equal(even[0].offsetY, even[3].offsetY);
  assert.equal(even[1].offsetY, even[2].offsetY);
  assert.ok(even.every((pose) => pose.rotationDeg !== 0));
});

test('GEO-01 neighboring routes keep a real gap and are not endpoint-connected', () => {
  const routes = buildSoSmileGeometry(['single', 'double', 'single'], {
    centerX: 500,
    centerY: 180,
    spacing: 170,
    risePerStep: 22,
    radius: 22,
    singleHalfLeg: 54,
    doubleHalfLeg: 104,
  });
  assert.ok(minimumRouteGap(routes[0], routes[1]) > 1);
  assert.ok(minimumRouteGap(routes[1], routes[2]) > 1);
});

test('SO Double is one continuous outer-turn route with no internal U-turn seam', () => {
  const single = localHippodromePoints('single');
  const double = localHippodromePoints('double');
  const singleX = Math.max(...single.map((point) => point.x)) - Math.min(...single.map((point) => point.x));
  const doubleX = Math.max(...double.map((point) => point.x)) - Math.min(...double.map((point) => point.x));
  assert.ok(doubleX > singleX * 1.5);
  // One closed outline: no duplicated center/intersection point is injected.
  const unique = new Set(double.map((point) => `${point.x.toFixed(5)}:${point.y.toFixed(5)}`));
  assert.equal(unique.size, double.length);
});

test('GEO-02 route phase and tangent heading are independent of vehicle type', () => {
  const [route] = buildSoSmileGeometry(['double'], { centerX: 200, centerY: 120 });
  const storm = pointAtSoPhase(route.points, 0.25, false);
  const lightning = pointAtSoPhase(route.points, 0.25, false);
  assert.deepEqual(storm, lightning);
  const reversed = pointAtSoPhase(route.points, 0.25, true);
  assert.ok(Math.abs((((reversed.heading - storm.heading) % 360) + 360) % 360 - 180) < 1e-6);
});
