import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => vite.close());
const validation = await vite.ssrLoadModule('/lib/workspace-validation.ts');

test('workspace validation canonicalizes valid WKT before persistence', () => {
  const state = validation.normalizeAndValidateWorkspaceState({
    routes: [{ id: 'r1', geometry: ' linestring (34 32, 34.01 32, 34.01 32.01, 34 32) ' }],
    vehicleTypes: [{ id: 'a', name: 'A', minId: 1, maxId: 9, workSpeedKmh: 50 }, { id: 'b', name: 'B', minId: 10, maxId: 20, workSpeedKmh: 70 }],
  });
  assert.equal(state.routes[0].geometry, 'LINESTRING (34 32, 34.01 32, 34.01 32.01, 34 32)');
});

test('workspace validation rejects invalid WKT before either SQLite or D1 write', () => {
  assert.throws(() => validation.normalizeAndValidateWorkspaceState({
    routes: [{ id: 'r1', geometry: 'LINESTRING (34 32, 34.01 32, 34.01 32.01)' }],
  }), /סגירה|להיסגר/);
});

test('workspace validation rejects overlapping vehicle id ranges', () => {
  assert.throws(() => validation.normalizeAndValidateWorkspaceState({
    routes: [],
    vehicleTypes: [{ id: 'a', name: 'A', minId: 1, maxId: 10, workSpeedKmh: 50 }, { id: 'b', name: 'B', minId: 10, maxId: 20, workSpeedKmh: 70 }],
  }), /חופפים/);
});

test('workspace validation rejects non-positive work speed', () => {
  assert.throws(() => validation.normalizeAndValidateWorkspaceState({
    routes: [], vehicleTypes: [{ id: 'a', name: 'A', minId: 1, maxId: 10, workSpeedKmh: 0 }],
  }), /מהירות העבודה/);
});

test('legacy route sentinels stay readable during WKT migration', () => {
  const state = validation.normalizeAndValidateWorkspaceState({ routes: [{ id: 'legacy', geometry: 'CLOSED_ROUTE' }] });
  assert.equal(state.routes[0].geometry, 'CLOSED_ROUTE');
});
