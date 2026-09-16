import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('BW-OFF-010 investigation PDF uses configured WMTS defaults only through local proxy/cache', async () => {
  const renderer = await readFile('lib/investigation-pdf-wmts.ts', 'utf8');
  const release = await readFile('lib/investigation-pdf-release.ts', 'utf8');
  const panel = await readFile('components/bluewolf/investigation-report-panel.tsx', 'utf8');

  assert.match(renderer, /normalizeMapSources/);
  assert.match(renderer, /settings\?\.defaultMap/);
  assert.match(renderer, /wmtsLayers/);
  assert.match(renderer, /filter\(\(layer\) => layer\.enabled\)/);
  assert.match(renderer, /sort\(\(a, b\) => a\.order - b\.order\)/);
  assert.match(renderer, /layer\.opacity/);
  assert.match(renderer, /\/api\/map-sources\/proxy\?/);
  assert.match(renderer, /Engineering grid/);
  assert.match(renderer, /proxy\/cache מקומי/);
  assert.doesNotMatch(renderer, /source\.baseUrl/);
  assert.doesNotMatch(renderer, /authorization|Bearer|tokenQueryParam/);

  assert.match(release, /buildInvestigationWmtsMapPages/);
  assert.match(release, /jpegPagesToPdf\(\[\.\.\.engineeringPages, \.\.\.mapPages\]\)/);
  assert.match(panel, /buildInvestigationReleasePdf/);
  assert.match(panel, /BW-OFF-010/);
});
