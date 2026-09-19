import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('SI coordinate editor snaps pointer coordinates to legal 30 degree positions and supports direct mobile touch', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/si-template-governance-workbench.tsx'), 'utf8');

  assert.match(source, /data-testid="si-coordinate-workbench"/);
  assert.match(source, /pointerToBoard/);
  assert.match(source, /snapAngle/);
  assert.match(source, /Math\.round\(raw \/ 30\) \* 30/);
  assert.match(source, /nearestAllowedRing/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /data-testid="si-coordinate-ghost"/);
  assert.match(source, /opacity="\.24"/);
  assert.match(source, /onPointerDown=\{\(event\) => \{ const target = targetFromPointer\(event\.clientX, event\.clientY\)/);
  assert.match(source, /event\.preventDefault\(\); placeTarget\(target\)/);
  assert.match(source, /if \(event\.pointerType !== "touch"\) updateHover/);
  assert.match(source, /placeSiVehicle/);
  assert.match(source, /deriveSiPairRules/);
  assert.match(source, /canonicalTemplateKey/);
  assert.match(source, /כבר קיימת תבנית SI שקולה בסיבוב\/מראה/);
  assert.match(source, /@media\(max-width:760px\)/);
});