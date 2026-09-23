import assert from 'node:assert/strict';
import test from 'node:test';
import { awaitNewCoreObservation } from '../scripts/verify-e2e-preflight.mjs';

function snapshot(at, kind = 'python-core') {
  return {
    schemaVersion: 'bluewolf.live-runtime.v1', serverId: '1', observedAt: new Date(at).toISOString(),
    source: { kind, health: 'healthy' },
    groups: { si: {
      members: [{ scoreValid: true, latitude: 32, longitude: 34 }],
      detectedRoutes: [{ centerline: [[34, 32], [34.01, 32.01], [34.02, 32.02]] }],
      event: { id: 'core-event' },
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
