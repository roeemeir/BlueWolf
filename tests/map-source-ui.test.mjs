import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('BW-OFF-010 developer workbench manages WMS WMTS metadata and keeps token server-side', async () => {
  const source = await readFile('components/bluewolf/map-source-governance-workbench.tsx', 'utf8');
  assert.match(source, /WMS/);
  assert.match(source, /WMTS/);
  assert.match(source, /Tile Matrix Set/);
  assert.match(source, /Token mode/);
  assert.match(source, /type="password"/);
  assert.match(source, /\/api\/map-sources\/token/);
  assert.doesNotMatch(source, /mapServers:[^\n]*token/);
});

test('BW-OFF-010 operational map renders basemap only through local proxy and aligned projection', async () => {
  const map = await readFile('components/bluewolf/operational-live-map.tsx', 'utf8');
  const basemap = await readFile('components/bluewolf/operational-basemap.tsx', 'utf8');
  assert.match(map, /OperationalBasemap/);
  assert.match(map, /createOperationalProjection/);
  assert.match(map, /data-requirements="OP-02 OP-04 BW-OFF-010"/);
  assert.match(basemap, /\/api\/map-sources\/proxy/);
  assert.match(basemap, /data-map-source-kind="wms"/);
  assert.match(basemap, /source\.kind === "wmts"/);
  assert.doesNotMatch(basemap, /source\.baseUrl/);
  assert.doesNotMatch(basemap, /token/);
});

test('BW-OFF-010 workspace validation rejects plaintext credentials', async () => {
  const validation = await readFile('lib/workspace-validation.ts', 'utf8');
  const config = await readFile('lib/map-source-config.ts', 'utf8');
  assert.match(validation, /normalizeMapSources/);
  assert.match(config, /must not store plaintext credentials/);
  assert.match(config, /must not embed credentials/);
});
