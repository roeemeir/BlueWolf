import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('developer mode is tabbed with independent settings, QA, score and SI/SO authoring', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/developer-governance-workbench.tsx'), 'utf8');
  const general = await readFile(path.join(root, 'components/bluewolf/general-settings-workbench.tsx'), 'utf8');

  assert.match(source, /className="developer-primary-tabs"/);
  assert.match(source, /aria-label="בחירת אזור במצב מפתחים"/);
  for (const value of ['templates', 'routes', 'gt', 'sources', 'score', 'settings', 'qa']) {
    assert.match(source, new RegExp(`TabsTrigger value="${value}"`));
    assert.match(source, new RegExp(`TabsContent value="${value}"`));
  }
  assert.doesNotMatch(source, /TabsTrigger value="vehicles"/);
  assert.doesNotMatch(source, /TabsTrigger value="system"/);
  assert.match(source, /TabsContent value="settings"><GeneralSettingsWorkbench/);
  assert.match(general, /<VehicleRangeWorkbench/);
  assert.match(source, /TabsContent value="qa"><QaTruthWorkbench/);
  assert.match(source, /TabsContent value="score"><div className="governed-score-only"><DeveloperView/);

  assert.match(source, /className="developer-template-tabs"/);
  assert.match(source, /TabsTrigger value="si"/);
  assert.match(source, /TabsTrigger value="so"/);
  assert.match(source, /TabsContent value="si"><SiTemplateGovernanceWorkbench/);
  assert.match(source, /TabsContent value="so"><SoTemplateGovernanceWorkbench/);
  assert.doesNotMatch(source, /so-vehicle-palette/);
  assert.match(source, /@media\(max-width:760px\)/);
});
