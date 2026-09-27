import assert from 'node:assert/strict';
import test from 'node:test';
import { awaitNewCoreObservation } from '../scripts/verify-e2e-preflight.mjs';

function snapshot(at, kind = 'python-core') {
  return {
    schemaVersion: 'bluewolf.live-runtime.v1', serverId: '1', observedAt: new Date(at).toISOString(),
    source: { kind, health: 'healthy' },
    groups: { si: {
      id: 'si-group-1', family: 'SI', observedAt: new Date(at).toISOString(),
      scoreValid: true, total: 82, sync: 80, route: 84, templateId: 'si-bound',
      members: [{ id: 101, scoreValid: true, score: 81, latitude: 32, longitude: 34 }],
      detectedRoutes: [{ routeId: 'confirmed-route', centerline: [
        { latitude: 32, longitude: 34 }, { latitude: 32.01, longitude: 34.01 },
        { latitude: 32.02, longitude: 34.02 },
      ] }],
      event: { id: 'core-event', startedAt: new Date(at - 20_000).toISOString(), active: true },
    } },
  };
}

test('E2E waits through unchanged HTTP Core snapshots until an actual later source observation', async () => {
  const now = Date.now();
  const first = now - 5_000;
  let reads = 0;
  let waits = 0;
  const newest = await awaitNewCoreObservation({
    serverId: '1', firstObservedMs: first, pollSeconds: 5, maxWaitMs: 10_000,
    read: async () => snapshot(++reads < 5 ? first : first + 5_000),
    sleep: async ms => { assert.equal(ms, 1_000); waits += 1; },
  });
  assert.equal(newest, first + 5_000);
  assert.equal(reads, 5);
  assert.equal(waits, 5);
});

test('E2E rejects a static Core feed even when every HTTP request succeeds', async () => {
  const first = Date.now() - 1_000;
  await assert.rejects(
    awaitNewCoreObservation({ serverId: '1', firstObservedMs: first, maxWaitMs: 2_000,
      read: async () => snapshot(first), sleep: async () => {} }),
    /did not advance/,
  );
});

test('E2E never treats a simulated later snapshot as operational progress', async () => {
  const first = Date.now() - 3_000;
  await assert.rejects(
    awaitNewCoreObservation({ serverId: '1', firstObservedMs: first, maxWaitMs: 2_000,
      read: async () => snapshot(first + 1_000, 'simulation'), sleep: async () => {} }),
    /not Core evidence/,
  );
});
