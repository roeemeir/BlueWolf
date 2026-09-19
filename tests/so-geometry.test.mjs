import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { DOUBLE_HIPPODROME_BREAK_DEG, buildSoSmileGeometry, localHippodromePoints, minimumRouteGap, pointAtSoPhase, soSmilePoses, soSmileChainPoses } = await vite.ssrLoadModule('/lib/so-geometry.ts');

function doublePhysicalAxes(points) {
  return [
    Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) * 180 / Math.PI,
    Math.atan2(points[3].y - points[2].y, points[3].x - points[2].x) * 180 / Math.PI,
  ];
}

test('GEO-01 uses exact 30 degree neighboring axes with a horizontal odd center', () => {
  const odd = soSmilePoses(5);
  assert.deepEqual(odd.map((pose) => pose.rotationDeg), [-60, -30, 0, 30, 60]);
  for (let index = 1; index < odd.length; index += 1) assert.equal(odd[index].rotationDeg - odd[index - 1].rotationDeg, 30);
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

test('SO mixed smile counts a Double as two consecutive physical 30-degree units', () => {
  const poses = soSmileChainPoses(['single', 'double', 'single'], 100, 10);
  assert.deepEqual(poses.map((pose) => pose.rotationDeg), [-45, 0, 45]);
  assert.equal(poses[0].offsetX, -poses[2].offsetX);
  assert.equal(poses[0].offsetY, poses[2].offsetY);
  const [left, right] = doublePhysicalAxes(localHippodromePoints('double'));
  assert.ok(Math.abs(left + 15) < 1e-9);
  assert.ok(Math.abs(right - 15) < 1e-9);
  const physicalAxes = [poses[0].rotationDeg, poses[1].rotationDeg + left, poses[1].rotationDeg + right, poses[2].rotationDeg];
  for (let index = 1; index < physicalAxes.length; index += 1) assert.ok(Math.abs(physicalAxes[index] - physicalAxes[index - 1] - 30) < 1e-9);
});

test('SO Double bends with the global concave smile, not into a local V', () => {
  const local = localHippodromePoints('double', { radius: 22, doubleHalfLeg: 104 });
  assert.ok(local[0].y - local[1].y > 0, 'left Double endpoint below its central joint');
  assert.ok(local[3].y - local[2].y > 0, 'right Double endpoint below its central joint');
  const routes = buildSoSmileGeometry(['single', 'double', 'single'], { centerX: 500, centerY: 180, spacing: 170, risePerStep: 22, radius: 22, singleHalfLeg: 54, doubleHalfLeg: 104 });
  assert.equal(routes.length, 3);
  assert.ok(routes[0].center.y > routes[1].center.y);
  assert.ok(routes[2].center.y > routes[1].center.y);
  assert.ok(minimumRouteGap(routes[0], routes[1]) > 1);
  assert.ok(minimumRouteGap(routes[1], routes[2]) > 1);
});

test('GEO-01 neighboring routes have no shared endpoint', () => {
  const routes = buildSoSmileGeometry(['single', 'double', 'single'], { centerX: 500, centerY: 180, spacing: 245, risePerStep: 22, radius: 22, singleHalfLeg: 54, doubleHalfLeg: 104 });
  assert.ok(minimumRouteGap(routes[0], routes[1]) > 1);
  assert.ok(minimumRouteGap(routes[1], routes[2]) > 1);
});

test('SO Double is continuous and has exact signed 30-degree internal break', () => {
  assert.equal(DOUBLE_HIPPODROME_BREAK_DEG, 30);
  const single = localHippodromePoints('single');
  const double = localHippodromePoints('double');
  const singleX = Math.max(...single.map((point) => point.x)) - Math.min(...single.map((point) => point.x));
  const doubleX = Math.max(...double.map((point) => point.x)) - Math.min(...double.map((point) => point.x));
  assert.ok(doubleX > singleX * 1.5);
  const [firstHeading, secondHeading] = doublePhysicalAxes(double);
  assert.ok(Math.abs(firstHeading + 15) < 1e-9);
  assert.ok(Math.abs(secondHeading - 15) < 1e-9);
  assert.ok(Math.abs(secondHeading - firstHeading - 30) < 1e-9);
  const unique = new Set(double.map((point) => `${point.x.toFixed(5)}:${point.y.toFixed(5)}`));
  assert.equal(unique.size, double.length);
});

test('GEO-02 route phase/tangent independent of vehicle type; reverse does not move vehicle', () => {
  const [route] = buildSoSmileGeometry(['double'], { centerX: 200, centerY: 120 });
  const forward = pointAtSoPhase(route.points, 0.25, false);
  assert.deepEqual(forward, pointAtSoPhase(route.points, 0.25, false));
  const reversed = pointAtSoPhase(route.points, 0.25, true);
  assert.ok(Math.abs(reversed.x - forward.x) < 1e-9);
  assert.ok(Math.abs(reversed.y - forward.y) < 1e-9);
  const delta = ((((reversed.heading - forward.heading) % 360) + 360) % 360);
  assert.ok(Math.abs(delta - 180) < 1e-6);
});
