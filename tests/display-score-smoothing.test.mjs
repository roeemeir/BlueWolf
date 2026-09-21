import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const smoothing = await vite.ssrLoadModule('/lib/display-score-smoothing.ts');

function point(second, total, eventId = 'event-a', valid = true) {
  return {
    schemaVersion: 'bluewolf.live-runtime-history.v1',
    serverId: '7',
    observedAt: `2026-09-16T10:00:${String(second).padStart(2, '0')}Z`,
    groups: [{ id: 'g1', name: 'G1', color: '#123456', total, sync: total, route: total, scoreValid: valid, event: { id: eventId, active: true } }],
  };
}

test('BW-SYNC-013 configurable smoothing changes display copy but never raw Core history', () => {
  const raw = [point(0, 100), point(5, 40), point(10, 70)];
  const before = structuredClone(raw);
  const smoothed = smoothing.smoothRuntimeHistoryForDisplay(raw, 10);

  assert.deepEqual(raw, before, 'raw Core history must remain byte-for-byte equivalent as data');
  assert.equal(smoothed[0].groups[0].total, 100);
  assert.equal(smoothed[1].groups[0].total, 70);
  assert.equal(smoothed[2].groups[0].total, 70);
  assert.notEqual(smoothed[1].groups[0].total, raw[1].groups[0].total);
});

test('BW-SYNC-013 zero-second mode is explicit raw display and window size is configurable', () => {
  const raw = [point(0, 100), point(5, 40), point(10, 70)];
  assert.deepEqual(smoothing.smoothRuntimeHistoryForDisplay(raw, 0), raw);
  assert.equal(smoothing.smoothRuntimeHistoryForDisplay(raw, 5)[2].groups[0].total, 55);
  assert.equal(smoothing.smoothRuntimeHistoryForDisplay(raw, 10)[2].groups[0].total, 70);
});

test('BW-SYNC-013 never smooths across event boundaries or unavailable scores', () => {
  const eventBoundary = [point(0, 100, 'event-a'), point(5, 20, 'event-b')];
  assert.equal(smoothing.smoothRuntimeHistoryForDisplay(eventBoundary, 30)[1].groups[0].total, 20);

  const invalidBoundary = [point(0, 100), point(5, 0, 'event-a', false), point(10, 20)];
  const result = smoothing.smoothRuntimeHistoryForDisplay(invalidBoundary, 30);
  assert.equal(result[2].groups[0].total, 20);
  assert.equal(result[1].groups[0].scoreValid, false);
});

test('BW-SYNC-013 non-finite score cannot contaminate another frame even when marked valid', () => {
  const raw = [point(0, 100), point(5, 40), point(10, 20)];
  raw[1].groups[0].sync = Number.NaN;
  const before = structuredClone(raw);
  const result = smoothing.smoothRuntimeHistoryForDisplay(raw, 30);
  assert.deepEqual(raw, before, 'display smoothing must not rewrite raw evidence');
  assert.equal(result[0].groups[0].total, 100);
  assert.equal(result[2].groups[0].total, 20, 'non-finite intermediate frame breaks the smoothing segment');
  assert.equal(result[2].groups[0].sync, 20);
  assert.equal(result[2].groups[0].route, 20);
  assert.equal(result[1].groups[0].total, 40, 'bad frame must not be averaged into a fabricated valid score');
  assert.ok(Number.isNaN(result[1].groups[0].sync));
});

test('BW-SYNC-013 rejects unreasonable display windows rather than altering scoring semantics', () => {
  assert.throws(() => smoothing.smoothRuntimeHistoryForDisplay([], -1), /window/);
  assert.throws(() => smoothing.smoothRuntimeHistoryForDisplay([], 301), /window/);
});
