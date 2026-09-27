import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'bw-route-wkt-'));
process.env.BLUEWOLF_SQLITE_PATH = join(dir, 'workspace.sqlite');
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });

const wkt = await vite.ssrLoadModule('/lib/route-wkt.ts');
const geometry = await vite.ssrLoadModule('/lib/route-bank-geometry.ts');
const db = await vite.ssrLoadModule('/lib/sqlite-workspace.ts');

const initial = 'LINESTRING (34 32, 34.01 32, 34.01 32.01, 34 32)';
const viewport = { west: 33.9, east: 34.2, south: 31.9, north: 32.2 };

test('route WKT validates, normalizes and rejects non-closed geometry', () => {
  assert.equal(geometry.normalizeRouteGeometry(initial), initial);
  assert.throws(() => wkt.parseRouteWkt('LINESTRING (34 32, 34.01 32, 34.01 32.01)'), /סגירה|להיסגר/);
});

test('drag translates WGS84 geometry rather than persisting screen percentages', () => {
  const before = geometry.routeEditorPoint(initial, viewport);
  const moved = geometry.translateRouteByEditorDrag(initial, before, { xPct: before.xPct + 10, yPct: before.yPct - 5 }, viewport);
  const parsed = wkt.parseRouteWkt(moved);
  assert.equal(parsed.points[0].longitude, 34.03);
  assert.equal(parsed.points[0].latitude, 32.015);
  const after = geometry.routeEditorPoint(moved, viewport);
  assert.ok(Math.abs(after.xPct - (before.xPct + 10)) < 1e-9);
  assert.ok(Math.abs(after.yPct - (before.yPct - 5)) < 1e-9);
});

test('edited WKT survives SQLite workspace save/read with exact normalized geometry', async () => {
  const first = await db.readLocalWorkspace('route-bank-wkt');
  const moved = geometry.translateRouteByEditorDrag(initial, { xPct: 50, yPct: 50 }, { xPct: 55, yPct: 55 }, viewport);
  const state = { routes: [{ id: 'route-1', geometry: moved }] };
  const write = await db.writeLocalWorkspace('route-bank-wkt', JSON.stringify(state), 'routes', 'save-bank', 'wkt-persistence', first.revision);
  assert.equal(write.ok, true);
  const saved = await db.readLocalWorkspace('route-bank-wkt');
  assert.equal(saved.state.routes[0].geometry, geometry.normalizeRouteGeometry(moved));
});
