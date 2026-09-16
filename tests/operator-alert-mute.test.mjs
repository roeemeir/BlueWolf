import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('BW-UI-008 provides local audible alert and explicit mute windows', async () => {
  const source = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(source, /AudioContextConstructor/);
  assert.match(source, /oscillator\.start\(\)/);
  assert.match(source, /muteFor\(5\)/);
  assert.match(source, /muteFor\(15\)/);
  assert.match(source, /muteFor\(30\)/);
  assert.match(source, /muteFor\("restart"\)/);
  assert.match(source, /Date\.now\(\) \+ value \* 60_000/);
  assert.match(source, /setMutedUntil\(null\)/);
});

test('BW-UI-008 mute is session-local and does not persist across restart', async () => {
  const source = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(source, /useState<MuteUntil>\(null\)/);
  assert.doesNotMatch(source, /activeTemplateOverrides[^\n]*mutedUntil/);
  assert.doesNotMatch(source, /await save\([^\n]*mute/);
});
