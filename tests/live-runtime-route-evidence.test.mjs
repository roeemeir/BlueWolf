import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const runtime = await vite.ssrLoadModule('/lib/live-runtime.ts');

function payload() {
  return {
    schemaVersion: 'bluewolf.live-runtime.v1',
    serverId: '1', arena: 'Arena A', status: 'ok', observedAt: '2026-09-16T06:00:00Z',
    source: { kind: 'python-core', health: 'healthy' },
    groups: {},
    groupList: [{
      key: 'so', id: 'g1', name: 'G1', family: 'SO', subtitle: 'runtime',
      total: 88, sync: 90, route: 82, confidence: 95, color: '#123456',
      members: [{ id: 42, typeId: 'A', score: 88, sync: 90, route: 82, confidence: 95, phase: .25, scoreValid: true, latitude: 32, longitude: 34.8 }],
      templateId: 'tpl', reason: 'ok', success: 'ok', scoreValid: true, observedAt: '2026-09-16T06:00:00Z',
      detectedRoutes: [{
        routeInstanceId: 'r1', routeId: 'route-core', family: 'SO', subtype: 'hippodrome', topology: 'simple', direction: 'cw', detectionQuality: .91,
        centerline: [
          { latitude: 32, longitude: 34.8 },
          { latitude: 32.001, longitude: 34.801 },
          { latitude: 31.999, longitude: 34.802 },
        ],
      }],
    }],
  };
}

test('OP-02 Web contract preserves detected routes from Python Core', () => {
  const normalized = runtime.normalizeLiveRuntimeSnapshot(payload(), '1');
  const route = normalized.groupList[0].detectedRoutes[0];
  assert.equal(route.routeId, 'route-core');
  assert.equal(route.centerline.length, 3);
  assert.equal(route.detectionQuality, .91);
});

test('OP-02 Web contract rejects invalid WGS84 route evidence', () => {
  const value = payload();
  value.groupList[0].detectedRoutes[0].centerline[1].latitude = 95;
  assert.throws(() => runtime.normalizeLiveRuntimeSnapshot(value, '1'), /runtime route latitude is invalid/);
});
