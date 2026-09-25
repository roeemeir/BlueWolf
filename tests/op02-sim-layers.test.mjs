import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const windows = await vite.ssrLoadModule('/lib/operator-shared-window.ts');

test('OP-02 SIM exposes independent layers and a single map/chart shared per-server window', async () => {
  const source = await readFile('components/bluewolf/so-governed-visuals.tsx', 'utf8');
  const chart = await readFile('components/bluewolf/simulation-timeline.tsx', 'utf8');
  assert.match(source, /data-requirements="OP-02"/);
  assert.match(source, />עקבה נצפית<\/button>/);
  assert.match(source, />נתיב התרחיש \(סימולציה\)<\/button>/);
  assert.doesNotMatch(source, />נתיב מזוהה<\/button>/);
  assert.doesNotMatch(source, />קבוצות<\/button>/);
  assert.doesNotMatch(source, />בסיס<\/button>/);
  assert.deepEqual([...windows.OPERATOR_SHARED_WINDOWS], [30, 60, 90]);
  assert.match(source, /setOperatorWindowForServer\(serverId, minutes\)/);
  assert.match(source, /subscribeOperatorWindow\(serverId, setTraceWindow\)/);
  assert.match(chart, /useSyncExternalStore\(subscribeWindow/);
  assert.doesNotMatch(source, /SIM_TRACE_WINDOWS\.map/);
  assert.doesNotMatch(chart, /aria-label="חלון זמן של סימולציה"/);
  assert.match(source, /SIM_TRACE_RETENTION_MINUTES = 90/);
  assert.match(source, /observedLayer &&/);
  assert.match(source, /scoreTraceLayer &&/);
  assert.match(source, /relationLayer &&/);
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
