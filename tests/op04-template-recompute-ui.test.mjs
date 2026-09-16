import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-04 event-start resolves archived evidence, recomputes before persisting and wires one result everywhere', async () => {
  const operator = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  const timeline = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');
  const map = await readFile('components/bluewolf/operational-live-map.tsx', 'utf8');
  const reportPanel = await readFile('components/bluewolf/investigation-report-panel.tsx', 'utf8');
  const reportRoute = await readFile('app/api/investigation/report/route.ts', 'utf8');

  assert.match(operator, /resolveArchivedEventId/);
  assert.match(operator, /\/api\/investigation\/events\?/);
  assert.match(operator, /event\.lifecycle\.status === "active" \|\| event\.lifecycle\.status === "finalizing"/);
  assert.match(operator, /const currentEventId = snapshotEventId \?\? archiveEventId/);
  assert.match(operator, /mode === "event-start"/);
  assert.match(operator, /\/api\/investigation\/recompute/);
  assert.match(operator, /normalizeEventRecompute/);
  assert.match(operator, /recomputedResult\.eventId !== eventId \|\| recomputedResult\.templateId !== id/);
  const resolveIndex = operator.indexOf('/api/investigation/events?');
  const recomputeIndex = operator.indexOf('/api/investigation/recompute');
  const saveIndex = operator.indexOf('await save(next, "operator", "template-override"');
  assert.ok(resolveIndex >= 0 && recomputeIndex > resolveIndex, 'event archive must be consulted before recompute can be used');
  assert.ok(recomputeIndex >= 0 && saveIndex > recomputeIndex, 'workspace override must only persist after recompute succeeds');
  assert.match(operator, /setRecomputeOverride\(recomputedResult\)/);
  assert.match(operator, /groupFromEventRecompute/);
  assert.match(operator, /activeRecomputeOverride/);
  assert.match(operator, /recomputeOverride=\{activeRecomputeOverride\}/);
  assert.match(timeline, /historyWithEventRecompute/);
  assert.match(map, /traceWithEventRecompute/);
  assert.match(operator, /requiredCodeVersion: recomputedResult\.codeVersion/);
  assert.match(operator, /requiredConfigVersion: recomputedResult\.configVersion/);
  assert.match(operator, /requiredTemplateVersion: recomputedResult\.templateVersion/);
  assert.match(reportPanel, /requiredCodeVersion: edit\.requiredCodeVersion/);
  assert.match(reportRoute, /OP-04 result version mismatch/);
  assert.match(reportRoute, /result\.codeVersion !== override\.requiredCodeVersion/);
  assert.match(reportRoute, /result\.configVersion !== override\.requiredConfigVersion/);
  assert.match(reportRoute, /result\.templateVersion !== override\.requiredTemplateVersion/);
  assert.match(operator, /disabled=\{!eventStartEnabled\}/);
  assert.match(operator, /לא נמצא event evidence פעיל לקבוצה בארכיון/);
  assert.match(operator, /חישוב האירוע נכשל/);
});

test('OP-04 refresh restores only the same code/config/template version', async () => {
  const operator = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(operator, /sameRecomputeVersion/);
  assert.match(operator, /operator-refresh:/);
  assert.match(operator, /לא ניתן לשחזר חישוב רטרואקטיבי/);
  assert.match(operator, /saved event-start decision belongs to a different code\/config\/template version/);
});
