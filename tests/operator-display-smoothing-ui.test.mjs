import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const operatorSource = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
const timelineSource = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');

test('BW-SYNC-013 operator owns one smoothing window shared by current cards and timeline', () => {
  assert.match(operatorSource, /useState<DisplaySmoothingSeconds>\(10\)/);
  assert.match(operatorSource, /smoothRuntimeHistoryForDisplay\(recomputedDisplayHistory, smoothingSeconds\)/);
  assert.match(operatorSource, /smoothingSeconds=\{smoothingSeconds\}\s+onSmoothingSeconds=\{setSmoothingSeconds\}/);
  assert.match(timelineSource, /smoothingSeconds: DisplaySmoothingSeconds/);
  assert.match(timelineSource, /onSmoothingSeconds: \(value: DisplaySmoothingSeconds\) => void/);
  assert.doesNotMatch(timelineSource, /useState<DisplaySmoothingSeconds>/);
});

test('BW-SYNC-013 recompute is applied before smoothing and only display scores are copied to cards', () => {
  const recomputeIndex = operatorSource.indexOf('historyWithEventRecompute(originalDisplayHistory');
  const smoothingIndex = operatorSource.indexOf('smoothRuntimeHistoryForDisplay(recomputedDisplayHistory');
  assert.ok(recomputeIndex >= 0 && smoothingIndex > recomputeIndex, 'event recompute must precede display smoothing');
  assert.match(operatorSource, /return \{ \.\.\.recomputed, total: displayScore\.total, sync: displayScore\.sync, route: displayScore\.route \}/);
  assert.match(operatorSource, /const activeAlertGroup = runtimeGroups\.find\(\(group\) => group\.alert\)/);
  assert.doesNotMatch(operatorSource, /const activeAlertGroup = displayGroups\.find/);
});

test('BW-SYNC-013 historical cursor summary uses the same smoothed display history while WGS84 trace remains raw evidence', () => {
  assert.match(timelineSource, /resolveOperatorCursorFrame\(displayHistory, getRuntimeTrace\(serverId, 90\), cursorObservedAt\)/);
  assert.match(timelineSource, /ציוני Core, התראות ואירועים נשארים raw/);
});
