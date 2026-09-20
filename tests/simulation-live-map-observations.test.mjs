import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('BW-CR-006 displayed SI/SO vehicle fixes are observed synthetic samples, not exact route-template positions', async () => {
  const source = await readFile('components/bluewolf/so-governed-visuals.tsx', 'utf8');
  assert.match(source, /import \{ simulationObservedFix \} from "@\/lib\/simulation-live-navigation"/);
  assert.match(source, /const siPoints = scenario\.groups\.si\.members\.flatMap/);
  assert.match(source, /const soPoints = soMembers\.flatMap/);
  assert.match(source, /const observed = simulationObservedFix\(\{ serverId, vehicleId: vehicle\.id, tick, ideal \}\)/);
  assert.match(source, /return observed \? \[\{ \.\.\.observed, vehicle \}\] : \[\]/);
  assert.match(source, /const points = \[\.\.\.siPoints, \.\.\.soPoints\]\.map/);
});

test('BW-CR-006 map marks SIM observations as synthetic and does not draw across missing fixes or skipped ticks', async () => {
  const source = await readFile('components/bluewolf/so-governed-visuals.tsx', 'utf8');
  assert.match(source, /data-sim-navigation-source="synthetic-sim-navigation"/);
  assert.match(source, /SIM · GPS סינתטי עם רעש, רוח וחורי מדידה; לא תצפיות Core/);
  assert.match(source, /frame\.tick > previous\.tick && frame\.tick - previous\.tick <= 1/);
  assert.match(source, /previous\?\.points\.find\(\(item\) => item\.id === point\.id\)/);
  assert.match(source, /SIM · SYNTHETIC/);
  assert.doesNotMatch(source, /\{animate \? "LIVE" : "SNAPSHOT"\}/);
});
