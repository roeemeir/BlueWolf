import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const wmts = await vite.ssrLoadModule('/lib/wmts-capabilities.ts');
const maps = await vite.ssrLoadModule('/lib/map-source-config.ts');

const capabilities = `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.0.0">
  <ows:ServiceIdentification><ows:Title>Blue Wolf Internal GIS</ows:Title></ows:ServiceIdentification>
  <ows:OperationsMetadata>
    <ows:Operation name="GetTile"><ows:DCP><ows:HTTP><ows:Get xlink:href="https://gis.internal/wmts-kvp"/></ows:HTTP></ows:DCP></ows:Operation>
  </ows:OperationsMetadata>
  <Contents>
    <Layer>
      <ows:Title>Orthophoto</ows:Title><ows:Identifier>ortho</ows:Identifier>
      <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>IL3857</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL format="image/png" resourceType="tile" template="https://gis.internal/rest/{Layer}/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/>
    </Layer>
    <Layer>
      <ows:Title>Roads</ows:Title><ows:Identifier>roads</ows:Identifier>
      <Style isDefault="true"><ows:Identifier>line</ows:Identifier></Style>
      <Format>image/png</Format>
      <TileMatrixSetLink><TileMatrixSet>IL3857</TileMatrixSet></TileMatrixSetLink>
    </Layer>
    <TileMatrixSet>
      <ows:Identifier>IL3857</ows:Identifier><ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS>
      <TileMatrix><ows:Identifier>EPSG:3857:0</ows:Identifier><ScaleDenominator>559082264.0287178</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight></TileMatrix>
      <TileMatrix><ows:Identifier>EPSG:3857:1</ows:Identifier><ScaleDenominator>279541132.0143589</ScaleDenominator><TopLeftCorner>-20037508.342789244 20037508.342789244</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>2</MatrixWidth><MatrixHeight>2</MatrixHeight></TileMatrix>
    </TileMatrixSet>
  </Contents>
</Capabilities>`;

test('BW-OFF-010 parses namespaced GetCapabilities without confusing TileMatrixSetLink with definitions', () => {
  const catalog = wmts.parseWmtsCapabilities(capabilities);
  assert.equal(catalog.serviceTitle, 'Blue Wolf Internal GIS');
  assert.deepEqual(catalog.layers.map((layer) => layer.identifier), ['ortho', 'roads']);
  assert.equal(catalog.tileMatrixSets.length, 1);
  assert.equal(catalog.tileMatrixSets[0].identifier, 'IL3857');
  assert.deepEqual(catalog.tileMatrixSets[0].matrices.map((matrix) => matrix.identifier), ['EPSG:3857:0', 'EPSG:3857:1']);
  assert.deepEqual(catalog.getTileKvpUrls, ['https://gis.internal/wmts-kvp']);
  assert.match(catalog.layers[0].resourceUrls[0].template, /\{TileMatrix\}/);
});

test('BW-OFF-010 builds compatible defaults and validates independent multi-layer visibility', () => {
  const catalog = wmts.parseWmtsCapabilities(capabilities);
  const defaults = wmts.defaultWmtsLayerSelections(catalog);
  assert.equal(defaults.length, 2);
  assert.equal(defaults[0].enabled, true);
  assert.equal(defaults[1].enabled, false);
  const configured = wmts.validateWmtsSelections(catalog, [
    { ...defaults[0], enabled: true, order: 1, opacity: 0.7 },
    { ...defaults[1], enabled: true, order: 0, opacity: 1 },
  ]);
  assert.deepEqual(configured.map((item) => item.layer), ['roads', 'ortho']);
  assert.equal(configured[1].opacity, 0.7);
});

test('BW-OFF-010 supports REST ResourceURL and non-numeric TileMatrix identifiers', () => {
  const catalog = wmts.parseWmtsCapabilities(capabilities);
  const selections = wmts.defaultWmtsLayerSelections(catalog);
  const source = maps.normalizeMapSource({
    id: 'internal-wmts', name: 'Internal WMTS', kind: 'wmts', baseUrl: 'https://gis.internal/wmts', enabled: true, isDefault: true,
    tokenMode: 'bearer', wmtsCatalog: catalog, wmtsLayers: selections,
  });
  const layer = maps.resolveWmtsLayer(source, 'ortho');
  const url = maps.buildWmtsUpstreamUrl(source, {
    ...layer, tileMatrix: 'EPSG:3857:1', tileRow: 1, tileCol: 0,
  });
  assert.equal(url.toString(), 'https://gis.internal/rest/ortho/default/IL3857/EPSG%3A3857%3A1/1/0.png');
});

test('BW-OFF-010 falls back to advertised KVP GetTile when a layer has no ResourceURL', () => {
  const catalog = wmts.parseWmtsCapabilities(capabilities);
  const source = maps.normalizeMapSource({
    id: 'internal-wmts', name: 'Internal WMTS', kind: 'wmts', baseUrl: 'https://gis.internal/wmts', enabled: true, isDefault: true,
    tokenMode: 'none', wmtsCatalog: catalog, wmtsLayers: wmts.defaultWmtsLayerSelections(catalog),
  });
  const layer = maps.resolveWmtsLayer(source, 'roads');
  const url = maps.buildWmtsUpstreamUrl(source, { ...layer, tileMatrix: 'EPSG:3857:1', tileRow: 0, tileCol: 1 });
  assert.equal(url.origin + url.pathname, 'https://gis.internal/wmts-kvp');
  assert.equal(url.searchParams.get('LAYER'), 'roads');
  assert.equal(url.searchParams.get('TILEMATRIX'), 'EPSG:3857:1');
  assert.equal(url.searchParams.get('TILEMATRIXSET'), 'IL3857');
});
