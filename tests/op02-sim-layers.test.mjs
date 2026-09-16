import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-02 SIM exposes observed trace, route and group toggles with 30/60/90 windows', async () => {
  const source = await readFile('components/bluewolf/so-governed-visuals.tsx', 'utf8');
  assert.match(source, /data-requirements="OP-02"/);
  assert.match(source, /עקבה נצפית/);
  assert.match(source, /נתיב מזוהה/);
  assert.match(source, /קבוצות/);
  assert.match(source, /SIM_TRACE_WINDOWS = \[30, 60, 90\]/);
  assert.match(source, /SIM_TRACE_RETENTION_MINUTES = 90/);
  assert.match(source, /observedLayer &&/);
  assert.match(source, /showTrace &&/);
  assert.match(source, /showRelations &&/);
  assert.match(source, /groupLayer &&/);
  assert.match(source, /showRoutes && routeLayer/);
});

test('OP-02 SIM keeps observed trace and score-colored trace as separate layers', async () => {
  const source = await readFile('components/bluewolf/so-governed-visuals.tsx', 'utf8');
  assert.match(source, /className="observed-trace"/);
  assert.match(source, /className="score-trace"/);
  assert.match(source, /traceScoreColor\(point\.sync\)/);
  assert.doesNotMatch(source, /observed-trace[^]*traceScoreColor\(point\.sync\)/);
});
