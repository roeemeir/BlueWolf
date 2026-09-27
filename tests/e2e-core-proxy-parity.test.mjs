import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCoreProxyEvidenceParity, verifyCoreProxyParity } from '../scripts/e2e-core-proxy-parity.mjs';

const base = Date.now() - 2_000;
function sample(ms = base) {
  return {
    schemaVersion: 'bluewolf.live-runtime.v1', serverId: '1',
    observedAt: new Date(ms).toISOString(),
    source: { kind: 'python-core', health: 'healthy', ageSeconds: 0.2, configVersion: 'real-config' },
    groupList: [{ id: 'live-so', family: 'SO', total: 72, event: { id: 'observed-event' },
      detectedRoutes: [{ routeInstanceId: 'real-route', centerline: [[34, 32], [34.1, 32.1]] }],
      members: [{ id: 101, latitude: 32, longitude: 34, score: 72, scoreValid: true }] }],
  };
}

test('E2E compares identical Web/Core route, event, group and member evidence while ignoring request-time age only', async () => {
  const core = sample();
  const web = structuredClone(core);
  web.source.ageSeconds = 0.9;
  assert.doesNotThrow(() => assertCoreProxyEvidenceParity(core, web, '1'));
  const result = await verifyCoreProxyParity({ serverId: '1', readCore: async () => core, readWeb: async () => web });
  assert.equal(result.observedAt, core.observedAt);
});

test('E2E rejects altered scores, GPS, route evidence, event identity and provenance despite matching timestamps', () => {
  for (const alter of [
    row => { row.groupList[0].total = 99; },
    row => { row.groupList[0].members[0].longitude = 35; },
    row => { row.groupList[0].detectedRoutes[0].routeInstanceId = 'demo'; },
    row => { row.groupList[0].event.id = 'other-event'; },
    row => { row.source.configVersion = 'different-config'; },
  ]) {
    const web = sample();
    alter(web);
    assert.throws(() => assertCoreProxyEvidenceParity(sample(), web, '1'), /altered Core vehicles/);
  }
});

test('E2E handles one poll between direct Core and Web reads only by matching the next real Core snapshot', async () => {
  const first = sample(base);
  const second = sample(base + 1_000);
  let reads = 0;
  const observed = await verifyCoreProxyParity({
    serverId: '1', readCore: async () => (++reads === 1 ? first : second), readWeb: async () => second,
  });
  assert.equal(observed.observedAt, second.observedAt);
  assert.equal(reads, 2);
});

test('E2E fails closed when a second Core backend delivers a different observation', async () => {
  let reads = 0;
  await assert.rejects(verifyCoreProxyParity({ serverId: '1', attempts: 2,
    readCore: async () => sample(base + ++reads * 1_000),
    readWeb: async () => sample(base + 30_000),
  }), /never matched/);
  assert.equal(reads, 4);
});

test('E2E refuses an altered proxy response even if a Core timestamp matches on the next attempt', async () => {
  const web = sample();
  web.groupList[0].event.id = 'sim-event';
  let attempts = 0;
  await assert.rejects(verifyCoreProxyParity({ serverId: '1',
    readCore: async () => { attempts += 1; return sample(); }, readWeb: async () => web,
  }), /altered Core vehicles/);
  assert.equal(attempts, 2);
});
