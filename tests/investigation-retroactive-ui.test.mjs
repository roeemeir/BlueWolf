import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('retroactive investigation correction is explicit, Core-backed and fail-closed', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/investigation-retroactive-panel.tsx'), 'utf8');
  assert.match(source, /BW-REP-007/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /בחר את כל הטווח/);
  assert.match(source, /\/api\/investigation\/events/);
  assert.match(source, /\/api\/investigation\/recompute/);
  assert.match(source, /applyRetroactiveTemplateBatch/);
  assert.match(source, /אין שמירה חלקית/);
  assert.match(source, /retroactive-template/);
  assert.doesNotMatch(source, /buildEvents/);
  assert.doesNotMatch(source, /getServerScenario/);
});

test('investigation report surface exposes retroactive correction before PDF generation', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/investigation-report-panel.tsx'), 'utf8');
  assert.match(source, /InvestigationRetroactivePanel/);
  assert.match(source, /<InvestigationRetroactivePanel server=\{server\} \/>/);
  assert.match(source, /BW-REP-008 BW-REP-009 BW-REP-011/);
});
