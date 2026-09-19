import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('investigation uses one range selector, one web report and PDF from the same Core dataset', async () => {
  const workspace = await readFile(path.join(root, 'components/bluewolf/investigation-workspace.tsx'), 'utf8');
  const dashboard = await readFile(path.join(root, 'components/bluewolf/dashboard-app.tsx'), 'utf8');
  const route = await readFile(path.join(root, 'app/api/investigation/report/route.ts'), 'utf8');

  assert.match(dashboard, /InvestigationWorkspace/);
  assert.doesNotMatch(dashboard, /InvestigationReportPanel/);
  assert.doesNotMatch(dashboard, /<InvestigationView/);

  const timeInputs = workspace.match(/type="datetime-local"/g) ?? [];
  assert.equal(timeInputs.length, 2, 'the investigation workspace must expose exactly one from/to pair');
  assert.match(workspace, /אישור והצג דוח/);
  assert.match(workspace, /Web Investigation Report/);
  assert.match(workspace, /הפק דוח PDF/);
  assert.match(workspace, /buildInvestigationReleasePdf\(loadState\.envelope\.report\)/);
  assert.match(workspace, /PDF הופק מאותו dataset שמוצג בדוח ה-Web/);

  assert.match(workspace, /\/api\/investigation\/report/);
  assert.match(workspace, /format: "data"/);
  assert.match(workspace, /x-bluewolf-report-source/);
  assert.match(workspace, /core-event-archive/);
  assert.match(workspace, /ציונים כוללים לפי קבוצה/);
  assert.match(workspace, /עקבות ונתיבים לפי אירועים/);
  assert.match(workspace, /פרקי תחקור/);
  assert.match(workspace, /EventChapter/);
  assert.match(workspace, /Root causes/);
  assert.match(workspace, /ציונים לפי רכב/);
  assert.match(workspace, /@media\(max-width:760px\)/);
  assert.match(workspace, /event-chapter-grid\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(workspace, /\bwindow\.print\s*\(\s*\)\s*;/);
  assert.doesNotMatch(workspace, /getServerScenario|buildEvents/);

  assert.match(route, /activeTemplateId/);
  assert.match(route, /missingTemplateEvents/);
  assert.match(route, /normalizeEventRecompute/);
  assert.match(route, /buildInvestigationPdf/);
  assert.match(route, /content-type.*application\/pdf/);
  assert.match(route, /x-bluewolf-code-version/);
  assert.match(route, /x-bluewolf-config-version/);
  assert.doesNotMatch(route, /getServerScenario|buildEvents/);
});
