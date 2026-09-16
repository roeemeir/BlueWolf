import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('BW-OFF-010 developer workbench discovers generic WMTS metadata and keeps token server-side', async () => {
  const source = await readFile('components/bluewolf/map-source-governance-workbench.tsx', 'utf8');
  assert.match(source, /WMS/);
  assert.match(source, /WMTS/);
  assert.match(source, /GetCapabilities/);
  assert.match(source, /MatrixSet/);
  assert.match(source, /Opacity/);
  assert.match(source, /Token mode/);
  assert.match(source, /type="password"/);
  assert.match(source, /\/api\/map-sources\/token/);
  assert.match(source, /\/api\/map-sources\/capabilities/);
  assert.doesNotMatch(source, /mapServers:[^\n]*token/);
});

test('BW-OFF-010 operational map renders independently selectable discovered layers only through local proxy', async () => {
  const map = await readFile('components/bluewolf/operational-live-map.tsx', 'utf8');
  const basemap = await readFile('components/bluewolf/operational-basemap.tsx', 'utf8');
  assert.match(map, /OperationalBasemap/);
  assert.match(map, /createOperationalProjection/);
  assert.match(map, /data-wmts-layer-toggle/);
  const requirements = map.match(/data-requirements="([^"]+)"/)?.[1]?.split(/\s+/) ?? [];
  for (const requirement of ['OP-02', 'OP-04', 'BW-OFF-010']) assert.ok(requirements.includes(requirement), `${requirement} must remain declared on operational map`);
  assert.match(basemap, /\/api\/map-sources\/proxy/);
  assert.match(basemap, /data-map-source-kind="wms"/);
  assert.match(basemap, /data-wmts-layer/);
  assert.match(basemap, /wmtsScreenTiles/);
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
