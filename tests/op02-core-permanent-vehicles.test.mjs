import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('components/bluewolf/operational-live-map.tsx', 'utf8');

test('OP-02 Core basemap is permanent while WMTS and evidence layers remain independently selectable', () => {
  assert.match(source, /<OperationalBasemap source=\{mapSource\} projection=\{projection\} visibleWmtsLayers=\{visibleWmtsLayers\} \/>/);
  assert.match(source, /<rect width=\{VIEW_WIDTH\} height=\{VIEW_HEIGHT\} className="v04-map-wash" \/>/);
  assert.doesNotMatch(source, /\bshowBase\b/);
  assert.doesNotMatch(source, />בסיס<\/button>/);
  assert.match(source, /data-wmts-layer-toggle=\{selection\.layer\}/);
  assert.match(source, /showObservedTrace && <g className="observed-trace"/);
  assert.match(source, /showScoreTrace && <g className="score-trace"/);
});

test('OP-02 valid Core positions remain visible independently of SI group hull and template layers', () => {
  assert.match(source, /const \[showGroupOutlines, setShowGroupOutlines\] = useState\(true\)/);
  assert.match(source, /showGroupOutlines && !historical && <g className="v04-group-shapes"/);
  assert.match(source, /<g className="v04-vehicles">\{points\.map\(\(point\) =>/);
  assert.doesNotMatch(source, /\{showGroups && <g className="v04-vehicles"/);
  assert.doesNotMatch(source, /\bshowGroups\b/);
  assert.match(source, /role=\{historical \? undefined : "button"\}/);
  assert.match(source, /aria-label=\{`\$\{point\.groupName\}, רכב \$\{point\.vehicle\.id\}/);
  assert.match(source, /showTemplate && !historical && <g className="v04-template-assignment-layer"/);
  assert.match(source, /!historical && showTemplate && soRelationLabels\.length > 0/);
});
