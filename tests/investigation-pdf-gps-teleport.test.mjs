import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });
const { investigationEventNavigationEvidence, PDF_NAVIGATION_MAX_DISPLAY_SPEED_MPS } =
  await vite.ssrLoadModule('/lib/investigation-pdf-navigation-evidence.ts');

const startAt = '2026-09-19T12:00:00.000Z';
const endAt = '2026-09-19T12:01:00.000Z';
const frame = (second, latitude, longitude) => ({
  observedAt: `2026-09-19T12:00:${String(second).padStart(2, '0')}.000Z`,
  navigation: [{ memberId: 'vehicle-17', vehicleIdentifier: 17, latitude, longitude }],
});
const sample = (points) => ({ result: { startAt, endAt, points } });

test('gross WGS84 GPS teleport never becomes a straight PDF track; both recorded fixes stay visible', () => {
  assert.equal(PDF_NAVIGATION_MAX_DISPLAY_SPEED_MPS, 1_000);
  const result = investigationEventNavigationEvidence(sample([
    frame(2, 31.2, 34.3),
    frame(4, 31.2001, 34.3001),
    frame(6, 32.2, 35.3), // Valid WGS84 but physically impossible displacement in 2 s.
    frame(8, 31.2002, 34.3002),
    frame(10, 31.2003, 34.3003),
  ]), -Infinity, Infinity);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].segments.map((segment) => segment.length), [2, 1, 2]);
  assert.equal(result[0].segments[1][0].latitude, 32.2, 'do not falsify observed evidence by dropping the spike');
  assert.equal(result[0].first.observedAt, frame(2, 0, 0).observedAt);
  assert.equal(result[0].last.observedAt, frame(10, 0, 0).observedAt);
});

test('crossing the antimeridian is a short local hop, not a false teleport', () => {
  const result = investigationEventNavigationEvidence(sample([
    frame(2, 0, 179.999),
    frame(4, 0, -179.999),
    frame(6, 0, -179.998),
  ]), -Infinity, Infinity);
  assert.deepEqual(result[0].segments.map((segment) => segment.length), [3]);
});
