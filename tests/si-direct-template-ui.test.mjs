import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('SI editor is direct coordinate-driven three-ring placement and the legacy counter editor is inaccessible', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/si-template-governance-workbench.tsx'), 'utf8');
  const governance = await readFile(path.join(root, 'components/bluewolf/developer-governance-workbench.tsx'), 'utf8');
  assert.match(source, /SI-01 BW-SYNC-001 BW-SYNC-002/);
  assert.match(source, /data-testid="si-coordinate-board"/);
  assert.match(source, /inner.*פנימית/);
  assert.match(source, /middle.*ביניים/);
  assert.match(source, /outer.*חיצונית/);
  assert.match(source, /Array\.from\(\{ length: 12 \}/);
  assert.match(source, /placeSiVehicle/);
  assert.match(source, /siPositions is the source of truth/);
  assert.doesNotMatch(source, /siCounts|setSiCounts|setSiAngles|setSiRings/);
  assert.match(governance, /<SiTemplateGovernanceWorkbench\s*\/>/);
  assert.doesNotMatch(governance, /<TemplateGovernanceWorkbench\s*\/>/);
  assert.doesNotMatch(governance, /import\s+\{\s*TemplateGovernanceWorkbench\s*\}/);
});

test('SI-01 hover ghost is visual-only while touch-down places on a legal coordinate', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/si-template-governance-workbench.tsx'), 'utf8');
  assert.match(source, /pointerToBoard/);
  assert.match(source, /nearestAllowedRing/);
  assert.match(source, /snapAngle/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /data-testid="si-coordinate-ghost"/);
  assert.match(source, /pointerEvents="none"/);
  assert.match(source, /onPointerDown=.*targetFromPointer\(event\.clientX, event\.clientY\)/);
  assert.match(source, /placeTarget\(target\)/);
  assert.doesNotMatch(source, /onPointerMove=.*setPositions/);
});