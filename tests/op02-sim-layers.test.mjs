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
  const observedStart = source.indexOf('className="observed-trace"');
  const scoreStart = source.indexOf('className="score-trace"');
  assert.ok(observedStart >= 0 && scoreStart > observedStart, 'both trace layers must be present and separate');
  const observedBlock = source.slice(observedStart, scoreStart);
  const scoreEnd = source.indexOf('showRelations &&', scoreStart);
  const scoreBlock = source.slice(scoreStart, scoreEnd > scoreStart ? scoreEnd : source.length);
  assert.doesNotMatch(observedBlock, /traceScoreColor/);
  assert.match(scoreBlock, /traceScoreColor\(point\.sync\)/);
});
