import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OP-05 simulation timeline renders SI and SO regardless of selected group', async () => {
  const source = await readFile('components/bluewolf/simulation-timeline.tsx', 'utf8');
  assert.match(source, /const GROUPS:[\s\S]*id: "si"[\s\S]*id: "so"/);
  assert.match(source, /const \[explicitGroups, setExplicitGroups\] = useState<GroupKey\[]>\(\[\]\)/);
  assert.match(source, /visibleGroups\.flatMap\(\(group\) => layers\.map/);
  assert.match(source, /opacity=\{group\.id === selected \? \.95 : \.48\}/);
  assert.doesNotMatch(source, /filter\(\(group\) => group\.id === selected\)/);
});

test('OP-05 operational timeline defaults to all runtime groups and selection only emphasizes', async () => {
  const source = await readFile('components/bluewolf/operational-timeline.tsx', 'utf8');
  assert.match(source, /const \[explicitGroupIds, setExplicitGroupIds\] = useState<string\[]>\(\[\]\)/);
  assert.match(source, /const visibleGroups = groups\.filter\(\(group\) => groupVisible\(group\.id, explicitGroupIds\)\)/);
  assert.match(source, /visibleGroups\.flatMap\(\(group\) => layers\.map/);
  assert.match(source, /const selected = group\.id === selectedGroupId/);
  assert.match(source, /opacity=\{selected \? \.95 : \.42\}/);
  assert.match(source, />כל הקבוצות<\/button>/);
  assert.doesNotMatch(source, /groups\.filter\(\(group\) => group\.id === selectedGroupId\)/);
});
