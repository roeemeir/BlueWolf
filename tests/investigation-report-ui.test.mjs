import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('investigation report UI uses binary PDF endpoint with Core provenance and no print fallback', async () => {
  const panel = await readFile(path.join(root, 'components/bluewolf/investigation-report-panel.tsx'), 'utf8');
  const dashboard = await readFile(path.join(root, 'components/bluewolf/dashboard-app.tsx'), 'utf8');
  const route = await readFile(path.join(root, 'app/api/investigation/report/route.ts'), 'utf8');

  assert.match(dashboard, /InvestigationReportPanel/);
  assert.match(panel, /\/api\/investigation\/report/);
  assert.match(panel, /application\/pdf/);
  assert.match(panel, /x-bluewolf-report-source/);
  assert.match(panel, /core-event-archive/);
  assert.match(panel, /הפק PDF לטווח/);
  assert.match(panel, /BW-REP-008 BW-REP-009 BW-REP-011/);
  assert.doesNotMatch(panel, /window\.print/);
  assert.doesNotMatch(panel, /getServerScenario|buildEvents/);

  assert.match(route, /activeTemplateId/);
  assert.match(route, /missingTemplateEvents/);
  assert.match(route, /normalizeEventRecompute/);
  assert.match(route, /buildInvestigationPdf/);
  assert.match(route, /content-type.*application\/pdf/);
  assert.match(route, /x-bluewolf-code-version/);
  assert.match(route, /x-bluewolf-config-version/);
  assert.doesNotMatch(route, /demo/i);
});
