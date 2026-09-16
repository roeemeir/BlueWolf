import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-05 simulation timeline renders SI and SO regardless of selected group', async () => {
  const source = await readFile('components/bluewolf/visuals.tsx', 'utf8');
  assert.match(source, /\(\["si", "so"\] as GroupKey\[\]\)\.map\(\(group\)/);
  assert.match(source, /opacity=\{group === selected \? \.95 : \.48\}/);
  assert.doesNotMatch(source, /filter\(\(group\) => group === selected\)/);
});

test('OP-05 operational timeline renders every runtime group and only emphasizes selection', async () => {
  const source = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');
  assert.match(source, /groups\.flatMap\(\(group\) => layers\.map/);
  assert.match(source, /const selected = group\.id === selectedGroupId/);
  assert.match(source, /opacity=\{selected \? \.95 : \.42\}/);
  assert.doesNotMatch(source, /groups\.filter\(\(group\) => group\.id === selectedGroupId\)/);
});
