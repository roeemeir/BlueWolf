import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const timeline = await vite.ssrLoadModule('/lib/operator-timeline.ts');

test('OP-05 30/60/90 windows are measured from newest data timestamp', () => {
  const rows = [
    { observedAt: '2026-09-16T05:00:00Z', id: 'old' },
    { observedAt: '2026-09-16T05:31:00Z', id: 'inside-30' },
    { observedAt: '2026-09-16T06:00:00Z', id: 'latest' },
  ];
  assert.deepEqual(timeline.filterByDataWindow(rows, 30).map((row) => row.id), ['inside-30', 'latest']);
  assert.deepEqual(timeline.filterByDataWindow(rows, 60).map((row) => row.id), ['old', 'inside-30', 'latest']);
  assert.deepEqual([...timeline.OPERATOR_TIMELINE_WINDOWS], [30, 60, 90]);
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

test('operational timeline exposes data-time controls, display-only smoothing and never derives filter from selectedGroupId', async () => {
  const source = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');
  assert.match(source, /OPERATOR_TIMELINE_WINDOWS/);
  assert.match(source, /smoothRuntimeHistoryForDisplay\(rawHistory, smoothingSeconds\)/);
  assert.match(source, /filterByDataWindow\(displayHistory, windowMinutes\)/);
  assert.match(source, /BW-SYNC-013/);
  assert.match(source, /explicitGroupIds/);
  assert.match(source, /כל הקבוצות/);
  assert.match(source, /scoreLayerDasharray\(layer\)/);
  assert.doesNotMatch(source, /setExplicitGroupIds\(\[selectedGroupId\]\)/);
});
