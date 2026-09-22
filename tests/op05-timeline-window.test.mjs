import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const timeline = await vite.ssrLoadModule('/lib/operator-timeline.ts');
const shared = await vite.ssrLoadModule('/lib/operator-shared-window.ts');

test('OP-05 30/60/90 windows are measured from newest data timestamp', () => {
  const rows = [
    { observedAt: '2026-09-16T05:00:00Z', id: 'old' },
    { observedAt: '2026-09-16T05:31:00Z', id: 'inside-30' },
    { observedAt: '2026-09-16T06:00:00Z', id: 'latest' },
  ];
  assert.deepEqual(timeline.filterByDataWindow(rows, 30).map((row) => row.id), ['inside-30', 'latest']);
  assert.deepEqual(timeline.filterByDataWindow(rows, 60).map((row) => row.id), ['old', 'inside-30', 'latest']);
  assert.deepEqual([...timeline.OPERATOR_TIMELINE_WINDOWS], [30, 60, 90]);
  assert.deepEqual([...shared.OPERATOR_SHARED_WINDOWS], [...timeline.OPERATOR_TIMELINE_WINDOWS]);
});

test('OP-05 line semantics are total solid, sync dashed, route dotted', () => {
  assert.equal(timeline.scoreLayerDasharray('total'), undefined);
  assert.equal(timeline.scoreLayerDasharray('sync'), '8 5');
  assert.equal(timeline.scoreLayerDasharray('route'), '2 5');
});

test('OP-05 explicit filter is independent of map selection', () => {
  assert.equal(timeline.groupVisible('g1', []), true);
  assert.equal(timeline.groupVisible('g2', []), true);
  assert.equal(timeline.groupVisible('g1', ['g1']), true);
  assert.equal(timeline.groupVisible('g2', ['g1']), false);
});

test('OP-05 shared window change reaches map and timeline listeners on the same server only', () => {
  shared.resetOperatorWindow();
  const map = [];
  const chart = [];
  const other = [];
  const stopMap = shared.subscribeOperatorWindow('1', (minutes) => map.push(minutes));
  const stopChart = shared.subscribeOperatorWindow('1', (minutes) => chart.push(minutes));
  const stopOther = shared.subscribeOperatorWindow('2', (minutes) => other.push(minutes));
  try {
    assert.equal(shared.operatorWindowForServer('1'), 30);
    shared.setOperatorWindowForServer('1', 60);
    shared.setOperatorWindowForServer('1', 90);
    shared.setOperatorWindowForServer('1', 30);
    assert.deepEqual(map, [60, 90, 30]);
    assert.deepEqual(chart, map);
    assert.deepEqual(other, []);
    assert.equal(shared.operatorWindowForServer('2'), 30);
    assert.throws(() => shared.setOperatorWindowForServer('1', 45), /30, 60 or 90/);
    stopChart();
    shared.setOperatorWindowForServer('1', 60);
    assert.deepEqual(map, [60, 90, 30, 60]);
    assert.deepEqual(chart, [60, 90, 30]);
  } finally {
    stopMap(); stopChart(); stopOther(); shared.resetOperatorWindow();
  }
});

test('operational timeline consumes a single shared time control, display-only smoothing and does not infer group filter from map selection', async () => {
  const source = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');
  assert.match(source, /subscribeOperatorWindow\(serverId, setWindowMinutes\)/);
  assert.match(source, /operatorWindowForServer\(serverId\)/);
  assert.match(source, /smoothRuntimeHistoryForDisplay\(rawHistory, smoothingSeconds\)/);
  assert.match(source, /filterByDataWindow\(displayHistory, windowMinutes\)/);
  assert.doesNotMatch(source, /aria-label="חלון זמן לפי נתוני Core"/);
  assert.match(source, /BW-SYNC-013/);
  assert.match(source, /explicitGroupIds/);
  assert.match(source, /כל הקבוצות/);
  assert.match(source, /scoreLayerDasharray\(layer\)/);
  assert.doesNotMatch(source, /setExplicitGroupIds\(\[selectedGroupId\]\)/);
});
