import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('GEO-01/GEO-02 active SO surfaces share one geometry source', async () => {
  const generator = await readFile(path.join(root, 'components/bluewolf/so-template-governance-workbench.tsx'), 'utf8');
  const governed = await readFile(path.join(root, 'components/bluewolf/so-governed-visuals.tsx'), 'utf8');
  const operator = await readFile(path.join(root, 'components/bluewolf/operator-view.tsx'), 'utf8');
  const direct = await readFile(path.join(root, 'lib/so-direct-placement.ts'), 'utf8');

  assert.match(generator, /buildSoSmileGeometry/);
  assert.match(generator, /pointAtSoPhase/);
  assert.doesNotMatch(generator, /SingleRouteShape|DoubleRouteShape|slotGeometry/);

  assert.match(governed, /buildSoSmileGeometry/);
  assert.match(governed, /pointAtSoPhase/);
  assert.match(governed, /data-requirements="GEO-01 GEO-02"/);
  assert.doesNotMatch(governed, /SO_ANCHORS|capsulePoint|doublePoint/);

  assert.match(operator, /GovernedLiveMap/);
  assert.match(operator, /GovernedTemplatePreview/);
  assert.doesNotMatch(operator, /<LiveMap\b|<TemplatePreview\b/);

  assert.match(direct, /from "@\/lib\/so-geometry"/);
  assert.doesNotMatch(direct, /function soSmilePoses/);
});

test('GEO-02 active simulation does not feed vehicle type into SO geometry', async () => {
  const governed = await readFile(path.join(root, 'components/bluewolf/so-governed-visuals.tsx'), 'utf8');
  const buildCalls = [...governed.matchAll(/buildSoSmileGeometry\(([^;]+)\)/g)].map((match) => match[1]);
  assert.ok(buildCalls.length >= 2);
  assert.ok(buildCalls.every((call) => !/vehicleType|typeById|\.typeId/.test(call)));
  assert.match(governed, /pointAtSoPhase\(route\.points/);
});
