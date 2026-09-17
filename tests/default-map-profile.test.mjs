import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });
const profile = await vite.ssrLoadModule('/lib/default-map-profile.ts');

test('BW-OFF-010 empty/demo workspace gets Omniscale WMTS as Tel Aviv default without storing the API key', () => {
  const migrated = profile.ensureTelAvivDemoMapState({ mapServers: [], settings: { defaultMap: 'engineering' } });
  assert.equal(migrated.settings.defaultMap, profile.DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  assert.equal(migrated.mapServers[0].id, profile.DEFAULT_PUBLIC_WMTS_SOURCE_ID);
  assert.equal(migrated.mapServers[0].kind, 'wmts');
  assert.equal(migrated.mapServers[0].isDefault, true);
  assert.equal(migrated.mapServers[0].tokenMode, 'path');
  assert.equal(migrated.mapServers[0].tokenPathPlaceholder, '{apiKey}');
  assert.match(migrated.mapServers[0].baseUrl, /\/v2\/%7BapiKey%7D\/WMTSCapabilities\.xml$/i);
  assert.doesNotMatch(JSON.stringify(migrated), /\/v2\/demo\//);
  const bounds = profile.telAvivDemoBounds();
  assert.ok(bounds.minLatitude < 32.0853 && bounds.maxLatitude > 32.0853);
  assert.ok(bounds.minLongitude < 34.7818 && bounds.maxLongitude > 34.7818);
});

test('BW-OFF-010 migration is one-way and never overrides a later user default', () => {
  const existing = {
    mapServers: [
      { ...profile.DEFAULT_PUBLIC_WMTS_SOURCE, isDefault: false },
      { id: 'private', name: 'private', kind: 'wmts', baseUrl: 'https://gis.local/wmts', attribution: '', enabled: true, isDefault: true, layer: 'ortho', tileMatrixSet: 'M', tokenMode: 'none' },
    ],
    settings: { defaultMap: 'private' },
  };
  const migrated = profile.ensureTelAvivDemoMapState(existing);
  assert.deepEqual(migrated, existing);
});

test('BW-OFF-010 operator basemap renders the Tel Aviv WMTS even before live WGS84 evidence exists', async () => {
  const source = await readFile('components/bluewolf/operational-basemap.tsx', 'utf8');
  assert.match(source, /DEFAULT_PUBLIC_WMTS_SOURCE_ID/);
  assert.match(source, /telAvivDemoBounds\(\)/);
  assert.match(source, /data-empty-demo=\{projection\.empty \? "tel-aviv"/);
  assert.doesNotMatch(source, /if \(!source \|\| !source\.enabled \|\| projection\.empty\) return null/);
});
