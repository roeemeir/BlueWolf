import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(async () => { await vite.close(); });
const trace = await vite.ssrLoadModule('/lib/score-trace.ts');
const pdf = await vite.ssrLoadModule('/lib/investigation-pdf-navigation-evidence.ts');
const continuity = await vite.ssrLoadModule('/lib/observed-navigation-continuity.ts');

const origin = Date.parse('2026-09-20T09:00:00.000Z');
const fix = (second, latitude, longitude) => ({
  timeMs: origin + second * 1000, vehicleId: 17,
  groupId: 'group-so', eventId: 'event-so', latitude, longitude, sync: 72,
});
const makeEvent = (points) => ({ result: {
  startAt: new Date(origin).toISOString(), endAt: new Date(origin + 60_000).toISOString(),
  points: points.map((point) => ({
    observedAt: new Date(point.timeMs).toISOString(),
    navigation: [{ memberId: 'vehicle-17', vehicleIdentifier: point.vehicleId,
      latitude: point.latitude, longitude: point.longitude }],
  })),
} });

test('Web and PDF use the same physical GPS continuity rule and retain both observed sides of a teleport', () => {
  const points = [fix(2, 31.2, 34.3), fix(4, 31.2001, 34.3001),
    fix(6, 32.2, 35.3), fix(8, 31.2002, 34.3002), fix(10, 31.2003, 34.3003)];
  const webSegments = trace.traceSegments(points);
  const [pdfEvidence] = pdf.investigationEventNavigationEvidence(makeEvent(points), -Infinity, Infinity);
  assert.deepEqual(pdfEvidence.segments.map((segment) => segment.length), [2, 1, 2]);
  assert.deepEqual(webSegments.map(([a, b]) => [a.timeMs, b.timeMs]),
    pdfEvidence.segments.flatMap((segment) => segment.slice(1).map((point, index) => [
      Date.parse(segment[index].observedAt), Date.parse(point.observedAt),
    ])));
  assert.equal(points.length, 5);
  assert.equal(pdfEvidence.segments.flat().length, 5, 'display guard must preserve, not rewrite or discard, the raw fixes');
  assert.equal(pdf.PDF_NAVIGATION_MAX_DISPLAY_SPEED_MPS,
    continuity.OBSERVED_NAVIGATION_MAX_DISPLAY_SPEED_MPS);
});

test('Web and PDF both accept the short 180-degree-meridian hop; gap bounds remain equal', () => {
  const points = [fix(2, 0, 179.999), fix(4, 0, -179.999), fix(6, 0, -179.998)];
  const webSegments = trace.traceSegments(points);
  const [pdfEvidence] = pdf.investigationEventNavigationEvidence(makeEvent(points), -Infinity, Infinity);
  assert.equal(webSegments.length, 2);
  assert.deepEqual(pdfEvidence.segments.map((segment) => segment.length), [3]);
  assert.equal(pdf.PDF_NAVIGATION_MAX_GAP_MS, continuity.OBSERVED_NAVIGATION_MAX_DISPLAY_GAP_MS);
});
