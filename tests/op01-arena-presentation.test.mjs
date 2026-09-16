import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-01 changing operator arena remains presentation-only while the preference persists in server scope', async () => {
  const source = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(source, /const \[arena, setArena\] = useState/);
  assert.match(source, /<Select value=\{arena\} onValueChange=\{\(value\) => \{ setArena\(value\); void persistServerScope\(\{ arena: value \}\); \}\}>/);
  assert.match(source, /מפה חיה · \{arena\}/);
  assert.match(source, /settings\.arena/);
  assert.match(source, /persistServerScope\(\{ arena: value \}\)/);
  assert.doesNotMatch(source, /save\([^\n]*arena/);
  assert.doesNotMatch(source, /getRuntimeGroups\([^)]*arena/);
  assert.doesNotMatch(source, /templateValues[^;]*arena/);
});
