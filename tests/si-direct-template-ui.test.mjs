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
