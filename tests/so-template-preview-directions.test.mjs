import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { buildSoSmileGeometry, pointAtSoPhase, soPhasesForRoute } = await vite.ssrLoadModule('/lib/so-geometry.ts');
const { placeSoPosition, toggleSoVehicleDirection } = await vite.ssrLoadModule('/lib/so-direct-placement.ts');

const angleDifference = (first, second) => ((first - second + 540) % 360) - 180;

test('SO preview tangent reverses the saved direction by 180 degrees for each Single and Double position', () => {
  const chain = ['single', 'double', 'single'];
  const routes = buildSoSmileGeometry(chain, { centerX: 200, centerY: 92, spacing: 105, risePerStep: 12, radius: 15, singleHalfLeg: 34, doubleHalfLeg: 58, samplesPerTurn: 12 });
  for (const route of routes) {
    for (const phase of soPhasesForRoute(route.kind)) {
      const forward = pointAtSoPhase(route.points, phase, false);
      const reverse = pointAtSoPhase(route.points, phase, true);
      assert.equal(forward.x, reverse.x);
      assert.equal(forward.y, reverse.y);
      assert.ok(Math.abs(angleDifference(forward.heading, reverse.heading)) === 180, `${route.kind} ${phase} heading must invert`);
    }
  }
});

test('SO saved placement direction is independent for two occupied slots in the same physical route', () => {
  const chain = ['double'];
  const first = placeSoPosition([], chain, 0, 0);
  assert.equal(first.ok, true);
  const second = placeSoPosition(first.placements, chain, 0, .25);
  assert.equal(second.ok, true);
  const switched = toggleSoVehicleDirection(second.placements, 0, .25);
  assert.deepEqual(switched.map(({ routeIndex, phase, direction }) => ({ routeIndex, phase, direction })), [
    { routeIndex: 0, phase: 0, direction: 'forward' },
    { routeIndex: 0, phase: .25, direction: 'reverse' },
  ]);
});

test('SO operator preview renders one numbered directional arrow per saved slot, not one synthetic dot per route', async () => {
  const source = await readFile('components/bluewolf/so-governed-visuals.tsx', 'utf8');
  const preview = source.slice(source.indexOf('export function GovernedTemplatePreview('));
  assert.match(preview, /template\.values === values && template\.soSpec\?\.chain === soKinds/);
  assert.match(preview, /placements\.map\(\(placement, index\) =>/);
  assert.match(preview, /pointAtSoPhase\(route\.points, placement\.phase, placement\.direction === "reverse"\)/);
  assert.match(preview, /rotate\(\$\{point\.heading\}\)/);
  assert.match(preview, /data-testid=\{`so-preview-direction-\$\{placement\.routeIndex\}-\$\{placement\.phase\}`\}/);
  assert.match(preview, /בתבנית זו לא נשמר כיוון התקדמות פרטני/);
  assert.doesNotMatch(preview, /routes\.map\(\(route, index\) => \{ const phase = soPhasesForRoute\(route.kind\)\[0\]/);
});
