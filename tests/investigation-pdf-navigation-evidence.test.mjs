import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const { investigationEventNavigationEvidence, PDF_NAVIGATION_MAX_GAP_MS } = await vite.ssrLoadModule('/lib/investigation-pdf-navigation-evidence.ts');
const { investigationEventColor } = await vite.ssrLoadModule('/lib/investigation-pdf-browser.ts');
const startAt = '2026-09-19T12:00:00.000Z';
const endAt = '2026-09-19T12:01:00.000Z';
const frame = (seconds, navigation) => ({ observedAt: `2026-09-19T12:00:${String(seconds).padStart(2, '0')}.000Z`, navigation });
const nav = (memberId, latitude, longitude, vehicleIdentifier = 17) => ({ memberId, latitude, longitude, vehicleIdentifier });
const sample = { result: { startAt, endAt, points: [
  frame(2, [nav('a', 31.2, 34.3), nav('b', null, null, 42)]),
  frame(8, [nav('a', 31.3, 34.4), nav('b', 32.2, 35.3, 42)]),
  frame(12, [nav('a', null, null), nav('b', 32.3, 35.4, 42)]),
  frame(20, [nav('a', 31.5, 34.6), nav('b', null, null, 42)]),
  frame(30, [nav('a', Number.NaN, 34.7), nav('b', null, null, 42)]),
  frame(40, [nav('a', 31.8, 34.9)]),
] } };

test('PDF markers use only first/last real observations; gaps and invalid WGS84 break line segments', () => {
  const members = investigationEventNavigationEvidence(sample, -Infinity, Infinity);
  assert.deepEqual(members.map((member) => member.memberId), ['a', 'b']);
  const a = members[0];
  assert.equal(a.vehicleIdentifier, 17);
  assert.deepEqual(a.segments.map((segment) => segment.length), [2, 1, 1]);
  assert.deepEqual(a.first, { observedAt: frame(2, []).observedAt, latitude: 31.2, longitude: 34.3 });
  assert.deepEqual(a.last, { observedAt: frame(40, []).observedAt, latitude: 31.8, longitude: 34.9 });
  assert.deepEqual(members[1].segments.map((segment) => segment.length), [2]);
  assert.equal(members[1].first.observedAt, frame(8, []).observedAt);
  assert.equal(members[1].last.observedAt, frame(12, []).observedAt);
});

test('clipping and absent evidence never extrapolate from a planned route or a neighboring event', () => {
  const from = Date.parse(frame(15, []).observedAt);
  const to = Date.parse(frame(25, []).observedAt);
  const members = investigationEventNavigationEvidence(sample, from, to);
  assert.equal(members.length, 1);
  assert.equal(members[0].first.observedAt, frame(20, []).observedAt);
  assert.equal(members[0].last.observedAt, frame(20, []).observedAt);
  assert.deepEqual(investigationEventNavigationEvidence({ result: { ...sample.result, points: [], routes: [{ centerline: [{ latitude: 31, longitude: 34 }] }] } }, -Infinity, Infinity), []);
  assert.deepEqual(investigationEventNavigationEvidence(sample, Date.parse(endAt) + 1, Infinity), []);
});

test('sparse archive splits unrecorded navigation gaps even without a missing-data frame', () => {
  assert.equal(PDF_NAVIGATION_MAX_GAP_MS, 10_000);
  const event = { result: { startAt, endAt, points: [
    frame(2, [nav('a', 31.1, 34.1)]),
    frame(12, [nav('a', 31.2, 34.2)]),
    frame(24, [nav('a', 31.3, 34.3)]),
    frame(26, [nav('a', 31.4, 34.4)]),
  ] } };
  const [member] = investigationEventNavigationEvidence(event, -Infinity, Infinity);
  assert.deepEqual(member.segments.map((segment) => segment.length), [2, 2]);
  assert.equal(member.first.observedAt, frame(2, []).observedAt);
  assert.equal(member.last.observedAt, frame(26, []).observedAt);
});

test('overview and per-event PDF maps can share a stable event color beyond seven events', () => {
  const colors = Array.from({ length: 12 }, (_, index) => investigationEventColor(index));
  assert.equal(new Set(colors).size, colors.length);
  assert.equal(investigationEventColor(8), colors[8]);
});
