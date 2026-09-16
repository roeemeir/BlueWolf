import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('BW-UI-005 timeline publishes one evidence timestamp and exposes LIVE return', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/operational-timeline.tsx'), 'utf8');
  assert.match(source, /data-requirements="OP-04 OP-05 BW-SYNC-013 BW-UI-005"/);
  assert.match(source, /publishOperatorCursor\(serverId, point\.observedAt\)/);
  assert.match(source, /publishOperatorCursor\(serverId, null\)/);
  assert.match(source, />LIVE<\/button>/);
  assert.match(source, /operator-historical-cursor-summary/);
  assert.match(source, /resolveOperatorCursorFrame/);
  assert.match(source, /אין frame מבצעי תואם בתוך ±10 שניות/);
});

test('BW-UI-005 operational map consumes the same cursor and fails closed for historical-only evidence', async () => {
  const source = await readFile(path.join(root, 'components/bluewolf/operational-live-map.tsx'), 'utf8');
  assert.match(source, /subscribeOperatorCursor\(serverId, setCursorObservedAt\)/);
  assert.match(source, /resolveOperatorCursorFrame\(getLiveRuntimeHistory\(serverId\), fullTrace, cursorObservedAt\)/);
  assert.match(source, /traceUpToCursor/);
  assert.match(source, /const routeEvidence = cursorObservedAt \? \[\] :/);
  assert.match(source, /const templateAssignments = cursorObservedAt \? \[\] :/);
  assert.match(source, /לא מוצג live fallback/);
  assert.match(source, /aria-disabled=\{historical \|\| undefined\}/);
  assert.match(source, /HISTORICAL EVIDENCE/);
});
