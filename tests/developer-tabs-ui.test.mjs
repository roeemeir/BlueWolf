import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('developer mode is tabbed and template authoring is split into SI and SO tabs', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/developer-governance-workbench.tsx'), 'utf8');

  assert.match(source, /className="developer-primary-tabs"/);
  assert.match(source, /aria-label="בחירת אזור במצב מפתחים"/);
  for (const value of ['templates', 'routes', 'gt', 'vehicles', 'sources', 'system']) {
    assert.match(source, new RegExp(`TabsTrigger value="${value}"`));
    assert.match(source, new RegExp(`TabsContent value="${value}"`));
  }

  assert.match(source, /className="developer-template-tabs"/);
  assert.match(source, /TabsTrigger value="si"/);
  assert.match(source, /TabsTrigger value="so"/);
  assert.match(source, /TabsContent value="si"><TemplateGovernanceWorkbench/);
  assert.match(source, /TabsContent value="so"><SoTemplateGovernanceWorkbench/);
  assert.match(source, /data-testid="so-vehicle-palette"/);
  assert.match(source, /display:none!important/);
  assert.match(source, /@media\(max-width:760px\)/);
});
