import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { closedOutlineClearance } = await vite.ssrLoadModule('/lib/so-route-clearance.ts');
const { minimumRouteGap, buildSoSmileGeometry } = await vite.ssrLoadModule('/lib/so-geometry.ts');

const validFar = [
  { x: 20, y: 20 }, { x: 24, y: 20 }, { x: 24, y: 24 }, { x: 20, y: 24 },
];

test('SO gap rejects a self-crossing polygon even when its signed area is nonzero', () => {
  const selfCrossing = [
    { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 0 }, { x: 5, y: 5 },
  ];
  const twiceArea = selfCrossing.reduce((total, point, index) => {
    const next = selfCrossing[(index + 1) % selfCrossing.length];
    return total + point.x * next.y - next.x * point.y;
  }, 0);
  assert.notEqual(twiceArea, 0, 'the previous signed-area-only guard would accept this outline');
  assert.equal(closedOutlineClearance(selfCrossing, validFar), 0);
  assert.equal(closedOutlineClearance(validFar, selfCrossing), 0);
  assert.equal(minimumRouteGap({ points: selfCrossing }, { points: validFar }), 0);
});

test('SO gap rejects a closed outline with a duplicate consecutive vertex', () => {
  const doubledVertex = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
  ];
  assert.equal(closedOutlineClearance(doubledVertex, validFar), 0);
  assert.equal(closedOutlineClearance(validFar, doubledVertex), 0);
});

test('SO gap still measures valid disjoint single and double routes', () => {
  const generated = buildSoSmileGeometry(['single', 'double', 'single'], { spacing: 245, risePerStep: 22 });
  assert.equal(generated.length, 3);
  for (let index = 1; index < generated.length; index += 1) {
    assert.ok(minimumRouteGap(generated[index - 1], generated[index]) > 0);
  }
  assert.ok(closedOutlineClearance(
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
    validFar,
  ) > 0);
});
