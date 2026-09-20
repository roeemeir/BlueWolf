import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('BW-OFF-010 investigation PDF uses configured WMTS defaults only through local proxy/cache', async () => {
  const renderer = await readFile('lib/investigation-pdf-wmts.ts', 'utf8');
  const release = await readFile('lib/investigation-pdf-release.ts', 'utf8');
  const brand = await readFile('lib/investigation-pdf-brand.ts', 'utf8');
  const panel = await readFile('components/bluewolf/investigation-report-panel.tsx', 'utf8');
  const logo = await readFile('components/bluewolf/wolf-logo.tsx', 'utf8');

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
  assert.match(release, /buildInvestigationBrandedCover/);
  assert.match(release, /\.\.\.engineeringPages\.slice\(0, 1\),\s*\.\.\.overviewMap,\s*\.\.\.engineeringPages\.slice\(1\)/);
  assert.match(release, /\.\.\.eventMaps/);
  assert.match(logo, /src="\/favicon\.svg"/);
  assert.match(brand, /image\.src = "\/favicon\.svg"/);
  assert.match(brand, /report\.events/);
  assert.match(brand, /scoredFrameCount/);
  assert.match(brand, /missingFrameCount/);
  assert.doesNotMatch(brand, /Core event archive/);
  assert.match(panel, /buildInvestigationReleasePdf/);
  assert.match(panel, /BW-OFF-010/);
});
