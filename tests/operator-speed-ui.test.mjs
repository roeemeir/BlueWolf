import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-03 operator displays observed or configured speed in knots, never km/h', async () => {
  const source = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(source, /formatKnotsFromMps/);
  assert.match(source, /formatKnotsFromKmh/);
  assert.match(source, /מהירות נצפית/);
  assert.match(source, /מהירות עבודה/);
  assert.doesNotMatch(source, /קמ״ש/);
});

test('OP-03 runtime contract carries speedMps as optional observed evidence', async () => {
  const runtime = await readFile('lib/live-runtime.ts', 'utf8');
  const enrichment = await readFile('core/src/bluewolf_runtime_adapter/position_enrichment.py', 'utf8');
  assert.match(runtime, /speedMps\?: number/);
  assert.match(runtime, /row\.speedMps < 0/);
  assert.match(enrichment, /math\.hypot\(east_f, north_f\)/);
  assert.match(enrichment, /member\["speedMps"\] = speed_mps/);
});
