import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-01 live operator has no arena filter and arena cannot scope runtime results', async () => {
  const source = await readFile('components/bluewolf/operator-view.tsx', 'utf8');

  assert.doesNotMatch(source, /const \[arena, setArena\] = useState/);
  assert.doesNotMatch(source, /<Select value=\{arena\}/);
  assert.doesNotMatch(source, /מפה חיה · \{arena\}/);
  assert.doesNotMatch(source, /settings\.arena/);
  assert.doesNotMatch(source, /persistServerScope\(\{ arena:/);
  assert.doesNotMatch(source, /getRuntimeGroups\([^)]*arena/);
  assert.doesNotMatch(source, /templateValues[^;]*arena/);
  assert.match(source, /<p className="eyebrow">מפה חיה<\/p>/);
  assert.match(source, /persistServerScope\(\{ mapProfile: value \}\)/);
});
