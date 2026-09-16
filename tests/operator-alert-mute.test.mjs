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

test('BW-UI-008 mute is session-local and is not written into Workspace state or save audit', async () => {
  const source = await readFile('components/bluewolf/operator-view.tsx', 'utf8');
  assert.match(source, /useState<MuteUntil>\(null\)/);
  const muteFunction = source.match(/const muteFor = \([\s\S]*?\n  };/)?.[0] ?? '';
  assert.match(muteFunction, /setMutedUntil/);
  assert.doesNotMatch(muteFunction, /\bsave\s*\(/);
  assert.doesNotMatch(muteFunction, /activeTemplateOverrides|templateApplications|investigationEdits/);
  assert.doesNotMatch(source, /mutedUntil\s*:/);
});
