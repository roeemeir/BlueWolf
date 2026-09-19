import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const operatorSource = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
const timelineSource = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');

test('BW-UI-008 operator consumes Core event and alert evidence as separate runtime concepts', () => {
  assert.match(operatorSource, /const activeAlertGroup = runtimeGroups\.find\(\(group\) => group\.alert\)/);
  assert.match(operatorSource, /const activeAlert = activeAlertGroup\?\.alert/);
  assert.match(operatorSource, /activeAlert && <section className=\{`active-alert/);
  assert.match(operatorSource, /<strong>\{activeAlert\.title\}<\/strong><p>\{activeAlert\.detail\}<\/p>/);
  assert.match(operatorSource, /אירוע = קבוצתיות רציפה\. קווי האירועים אינם התראות\./);
  assert.doesNotMatch(operatorSource, /const activeAlertGroup = displayGroups\.find/);
});

test('BW-UI-008 operational timeline derives event bands only from runtime history group.event evidence', () => {
  assert.match(timelineSource, /if \(!group\.event\?\.active\) continue/);
  assert.match(timelineSource, /const key = `\$\{group\.id\}:\$\{group\.event\.id\}`/);
  assert.match(timelineSource, /else spans\.set\(key, \{ id: group\.event\.id, groupId: group\.id/);
  assert.match(timelineSource, /className="v04-event-bands"/);
  assert.doesNotMatch(timelineSource, /low_score_alert_active|group\.alert/);
});

test('BW-UI-008 event identity remains the Core/archive event identity for recompute instead of a UI-generated id', () => {
  assert.match(operatorSource, /const currentEventId = snapshotEventId \?\? archiveEventId \?\? undefined/);
  assert.match(operatorSource, /const snapshotEventId = selectedMetadata\.event\?\.active === false \? undefined : selectedMetadata\.event\?\.id/);
  assert.doesNotMatch(operatorSource, /eventId\s*=\s*Date\.now|eventId\s*=\s*Math\.random/);
});
