import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-04 event-start template application recomputes before saving override', async () => {
  const source = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(source, /mode === "event-start"/);
  assert.match(source, /\/api\/investigation\/recompute/);
  assert.match(source, /normalizeEventRecompute/);
  assert.match(source, /recomputed\.eventId !== eventId \|\| recomputed\.templateId !== id/);
  const recomputeIndex = source.indexOf('/api/investigation/recompute');
  const saveIndex = source.indexOf('await save(next, "operator", "template-override"');
  assert.ok(recomputeIndex >= 0 && saveIndex > recomputeIndex, 'workspace override must only persist after recompute succeeds');
  assert.match(source, /אין event evidence פעיל לקבוצה; התבנית לא נשמרה/);
  assert.match(source, /חישוב האירוע נכשל/);
});
