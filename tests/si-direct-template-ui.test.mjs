import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('SI editor is direct three-ring placement and the legacy counter editor is inaccessible', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/template-governance-workbench.tsx'), 'utf8');
  const governance = await readFile(path.join(root, 'components/bluewolf/developer-governance-workbench.tsx'), 'utf8');

  assert.match(source, /BW-SYNC-001 BW-SYNC-002 BW-SYNC-003 BW-SYNC-004 BW-SYNC-005/);
  assert.match(source, /data-testid="si-direct-ring-board"/);
  assert.match(source, /inner.*פנימית/);
  assert.match(source, /middle.*ביניים/);
  assert.match(source, /outer.*חיצונית/);
  assert.match(source, /Array\.from\(\{ length: 12 \}/);
  assert.match(source, /placeSiVehicle/);
  assert.match(source, /siPositions הוא מקור האמת/);
  assert.doesNotMatch(source, /siCounts|setSiCounts|setSiAngles|setSiRings/);

  assert.match(governance, /TemplateGovernanceWorkbench/);
  assert.match(governance, /button:nth-child\(2\)/);
});

test('SI-01 hover ghost is visual-only and restricted to legal empty slots', async () => {
  const governance = await readFile(path.join(root, 'components/bluewolf/developer-governance-workbench.tsx'), 'utf8');
  assert.match(governance, /SI-01: desktop hover previews a legal empty placement without changing state/);
  assert.match(governance, /si-direct-ring-board/);
  assert.match(governance, /circle\[fill="transparent"\]\[opacity="0\.65"\]/);
  assert.match(governance, /:hover/);
  assert.match(governance, /:focus-visible/);
  assert.doesNotMatch(governance, /onMouseEnter|onPointerEnter|setSiPositions/);
});
