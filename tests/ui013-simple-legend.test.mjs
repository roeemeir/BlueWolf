import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const legend = await readFile('components/bluewolf/score-legend.tsx', 'utf8');
const operational = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');
const simulation = await readFile('components/bluewolf/simulation-timeline.tsx', 'utf8');
const css = await readFile('app/globals.css', 'utf8');

test('BW-UI-013 legend has exactly three score zones with explicit ranges and separators', () => {
  assert.match(legend, /label: "טוב", range: "80–100"/);
  assert.match(legend, /label: "בינוני", range: "50–79"/);
  assert.match(legend, /label: "נמוך", range: "<50"/);
  assert.equal((legend.match(/score-legend-separator/g) ?? []).length >= 2, true);
  assert.match(css, /\.score-legend-separator\{/);
});

test('BW-UI-013 line legend shows only active layers instead of a fixed overloaded list', () => {
  assert.match(legend, /const visibleLayers = \(\["total", "sync", "route"\] as ScoreLayer\[\]\)\.filter\(\(layer\) => layers\.includes\(layer\)\)/);
  assert.match(legend, /visibleLayers\.map/);
  assert.match(legend, /scoreLayerDasharray\(layer\)/);
});

test('BW-UI-013 same compact legend is used in live and simulation timelines', () => {
  assert.match(operational, /<ScoreLegend layers=\{layers\} showEvents \/>/);
  assert.match(simulation, /<ScoreLegend layers=\{layers\} \/>/);
  assert.match(operational, /BW-UI-013/);
  assert.match(simulation, /BW-UI-013/);
  assert.doesNotMatch(simulation, /כולל — רציף · סנכרון — מקווקו · נתיב — נקודות/);
});

test('BW-UI-013 event legend stays a single compact item and does not duplicate group filters', () => {
  assert.match(legend, /showEvents &&/);
  assert.match(legend, /<b>אירוע<\/b><small>פס תחתון<\/small>/);
  assert.doesNotMatch(legend, /groupVisible|selectedGroupId|group\.name/);
});
