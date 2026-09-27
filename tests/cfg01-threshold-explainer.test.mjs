import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });

const bluewolf = await vite.ssrLoadModule('/lib/bluewolf.ts');
const explainers = await vite.ssrLoadModule('/lib/threshold-explainer.ts');
const catalog = JSON.parse(await readFile('core/docs/ACTIVE_ALGORITHM_THRESHOLD_CATALOG.json', 'utf8'));
const developerSource = await readFile('components/bluewolf/developer-view.tsx', 'utf8');
const rows = new Map(catalog.thresholds.map((row) => [row.path, row]));

test('CFG-01 every score/threshold control has a governed explainer bound to the active Core catalog', () => {
  const keys = Object.keys(bluewolf.DEFAULT_WORKSPACE.thresholds).sort();
  assert.deepEqual(Object.keys(explainers.THRESHOLD_EXPLAINERS).sort(), keys);
  for (const key of keys) {
    const definition = explainers.THRESHOLD_EXPLAINERS[key];
    const row = rows.get(definition.catalogPath);
    assert.ok(row, `${key}: catalog path ${definition.catalogPath}`);
    assert.ok(['product', 'calibration'].includes(definition.classification));
    assert.equal(definition.classification, row.classification, `${key}: classification drift`);
    const sourceValue = definition.catalogSelector ? row.value[definition.catalogSelector] : row.value;
    const expected = Number(sourceValue) * definition.catalogScale;
    assert.equal(bluewolf.DEFAULT_WORKSPACE.thresholds[key], expected, `${key}: workspace default drifted from Core catalog`);
    assert.ok(definition.aspect.length >= 24, `${key}: aspect explanation`);
    assert.ok(definition.effect.length >= 24, `${key}: score-effect explanation`);
  }
});

test('CFG-01 developer UI opens a per-metric visual with current value and product/calibration classification', () => {
  assert.match(developerSource, /function ThresholdExplainerCard/);
  assert.match(developerSource, /data-threshold-explainer=\{fieldKey\}/);
  assert.match(developerSource, /thresholdClassificationLabel\(definition\.classification\)/);
  assert.match(developerSource, /ערך נוכחי \{value\}/);
  assert.match(developerSource, /aria-expanded=\{openThreshold === field\.key\}/);
  assert.match(developerSource, /<Info \/>המחשה/);
  assert.match(developerSource, /visualKind === "score-band"/);
  assert.match(developerSource, /visualKind === "eligibility-gate"/);
  assert.match(developerSource, /visualKind === "display-window"/);
  assert.match(developerSource, /visualKind === "status-boundary"/);
});

test('CFG-01 smoothing explainer explicitly stays display-only', () => {
  const row = explainers.THRESHOLD_EXPLAINERS.smoothingSeconds;
  assert.equal(row.classification, 'product');
  assert.match(row.effect, /raw Core score/);
  assert.match(row.effect, /alerts/);
  assert.match(row.effect, /events/);
  assert.match(row.effect, /grouping/);
});
