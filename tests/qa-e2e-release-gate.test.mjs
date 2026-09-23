import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  assertOperationalReady,
  assertOperationalConfig,
  assertObservedCoreSnapshot,
} from '../scripts/verify-e2e-preflight.mjs';

const operational = { ok: true, mode: 'operational', running: true, tickCount: 2, serverErrors: [] };
const config = {
  influx: { url: 'http://127.0.0.1:8086' },
  servers: [1, 2, 3].map(id => ({ id, tag: `server-${id}`, groups: [{ name: `group-${id}` }] })),
};
const snapshot = (observedAt = new Date().toISOString()) => ({
  schemaVersion: 'bluewolf.live-runtime.v1',
  serverId: '1', observedAt, source: { kind: 'python-core', health: 'healthy' },
  groups: { si: { event: { id: 'real-archived-event' }, members: [{ scoreValid: true, latitude: 32.08, longitude: 34.78 }],
    detectedRoutes: [{ centerline: [{ latitude: 32, longitude: 34 }, { latitude: 32.1, longitude: 34.1 }, { latitude: 32.2, longitude: 34.2 }] }] } },
});

test('QA-E2E transport-only health cannot masquerade as operational readiness', () => {
  assertOperationalReady(operational);
  for (const broken of [
    { ...operational, mode: 'transport-only' },
    { ...operational, tickCount: 0 },
    { ...operational, running: false },
    { ...operational, serverErrors: [{ serverId: 1, error: 'Influx unavailable' }] },
    { ...operational, ok: false },
  ]) assert.throws(() => assertOperationalReady(broken));
});

test('QA-E2E requires a real three-server Influx configuration and secrets', () => {
  assert.deepEqual(assertOperationalConfig(config, true), ['1', '2', '3']);
  assert.throws(() => assertOperationalConfig(config, false), /missing E2E Influx token/);
  assert.throws(() => assertOperationalConfig({ ...config, servers: config.servers.slice(0, 2) }, true));
  assert.throws(() => assertOperationalConfig({ ...config, influx: { url: 'http://influxdb2.internal:8086' } }, true));
});

test('QA-E2E refuses simulated, stale, scoreless and route-less snapshots', () => {
  const good = snapshot();
  assert.ok(Number.isFinite(assertObservedCoreSnapshot(good, '1')));
  for (const broken of [
    { ...good, source: { kind: 'simulation', health: 'healthy' } },
    { ...good, observedAt: '2026-01-01T00:00:00Z' },
    { ...good, groups: { si: { ...good.groups.si, detectedRoutes: [] } } },
    { ...good, groups: { si: { ...good.groups.si, members: [] } } },
    { ...good, groups: { si: { ...good.groups.si, event: undefined } } },
  ]) assert.throws(() => assertObservedCoreSnapshot(broken, '1'));
});

test('QA-E2E the former quick tunnel no longer emits any public URL or HTTP-only preview', async () => {
  const workflow = await readFile('.github/workflows/qa-quick-tunnel.yml', 'utf8');
  assert.match(workflow, /BLUEWOLF_OPERATIONAL_CONFIG:/);
  assert.match(workflow, /BLUEWOLF_INFLUX_TOKEN:/);
  assert.match(workflow, /verify-e2e-preflight\.mjs/);
  assert.match(workflow, /\/readyz/);
  assert.doesNotMatch(workflow, /\bcloudflared\b|trycloudflare\.com|actions\/upload-artifact|Publish QA URL artifact|Open QA Quick Tunnel/i);
  assert.doesNotMatch(workflow, /\bbluewolf-qa-url\b/);
  assert.match(workflow, /No tunnel, preview artifact or public link/);
});
