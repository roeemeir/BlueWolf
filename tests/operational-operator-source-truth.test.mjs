import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile('components/bluewolf/dashboard-app.tsx', 'utf8');
const definition = source.match(/export function hasVerifiedOperationalEvidence[\s\S]*?(?=\nfunction AppInner\()/)?.[0];
assert.ok(definition, 'source-evidence gate must be present in actual dashboard implementation');
const compiled = ts.transpileModule(definition, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { hasVerifiedOperationalEvidence: verified } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);
const now = Date.parse('2026-09-24T13:00:00Z');
const vehicle = { id: 14, scoreValid: true, latitude: 32.1, longitude: 34.8 };
const group = { id: 'observed-si', scoreValid: true, members: [vehicle] };
const snapshot = (overrides = {}) => ({
  schemaVersion: 'bluewolf.live-runtime.v1',
  serverId: '1',
  observedAt: new Date(now - 3_000).toISOString(),
  source: { kind: 'python-core', health: 'healthy' },
  groupList: [group],
  groups: {},
  ...overrides,
});

test('operational cards cannot mount with absent Core, wrong server, SIM or unavailable health', () => {
  assert.equal(verified(null, '1', now, 5), false);
  assert.equal(verified(snapshot({ serverId: '2' }), '1', now, 5), false);
  assert.equal(verified(snapshot({ source: { kind: 'simulation', health: 'healthy' } }), '1', now, 5), false);
  assert.equal(verified(snapshot({ source: { kind: 'python-core', health: 'unavailable' } }), '1', now, 5), false);
  assert.equal(verified(snapshot({ source: { kind: 'python-core', health: 'stale' } }), '1', now, 5), false);
});

test('a healthy HTTP response without an actually current source timestamp never becomes LIVE', () => {
  assert.equal(verified(snapshot({ observedAt: new Date(now - 31_000).toISOString() }), '1', now, 5), false);
  assert.equal(verified(snapshot({ observedAt: new Date(now + 6_000).toISOString() }), '1', now, 5), false);
  assert.equal(verified(snapshot({ observedAt: 'not-a-timestamp' }), '1', now, 5), false);
});

test('valid scored group and scored WGS84 member must occur in the same actual Core group', () => {
  assert.equal(verified(snapshot({ groupList: [] }), '1', now, 5), false);
  assert.equal(verified(snapshot({ groupList: [{ ...group, scoreValid: false }] }), '1', now, 5), false);
  assert.equal(verified(snapshot({ groupList: [{ ...group, members: [{ ...vehicle, scoreValid: false }] }] }), '1', now, 5), false);
  assert.equal(verified(snapshot({ groupList: [{ ...group, members: [{ ...vehicle, longitude: undefined }] }] }), '1', now, 5), false);
  assert.equal(verified(snapshot({ groupList: [{ ...group, members: [{ ...vehicle, latitude: Number.NaN }] }] }), '1', now, 5), false);
  assert.equal(verified(snapshot({ groupList: [{ ...group, members: [] }, { ...group, id: 'other', scoreValid: false, members: [vehicle] }] }), '1', now, 5), false);
  assert.equal(verified(snapshot(), '1', now, 5), true);
});

test('an actual legacy Core groups payload remains compatible without a demo groupList', () => {
  assert.equal(verified(snapshot({ groupList: undefined, groups: { si: group } }), '1', now, 5), true);
  assert.equal(verified(snapshot({ groupList: undefined, groups: {} }), '1', now, 5), false);
});

test('the actual rendered operational tab is gated; demo cards and INFLUX credentials never prove liveness', () => {
  assert.match(source, /dataMode === "simulation" \|\| operationalEvidenceReady\s*\? <OperatorView/);
  assert.match(source, /אין נתונים תפעוליים מאומתים/);
  assert.match(source, /לא התקבלה מה־Python Core/);
  assert.match(source, /operationalEvidenceReady \? `חי · \$\{runtimeLabel\}` : `לא מאומת/);
  assert.match(source, /setCoreSnapshot\(null\)/);
  assert.doesNotMatch(source, /influxConfigured \? "INFLUXDB 2"/);
});
