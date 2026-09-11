import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
const root = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'bw-sqlite-'));
process.env.BLUEWOLF_SQLITE_PATH = join(dir, 'workspace.sqlite');
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });
const db = await vite.ssrLoadModule('/lib/sqlite-workspace.ts');
const trace = await vite.ssrLoadModule('/lib/score-trace.ts');
const model = await vite.ssrLoadModule('/lib/bluewolf.ts');
test('SQLite saves atomically and rejects lost updates', async () => {
 assert.equal((await db.readLocalWorkspace('test-workspace')).revision, 0);
 assert.equal((await db.writeLocalWorkspace('test-workspace', '{"name":"local"}', 'configuration', 'save', '', 0)).revision, 1);
 assert.equal((await db.writeLocalWorkspace('test-workspace', '{"name":"stale"}', 'configuration', 'save', '', 0)).conflict, true);
 const saved = await db.readLocalWorkspace('test-workspace');
 assert.equal(saved.state.name, 'local'); assert.equal(saved.logs.length, 1);
});
test('trace preserves source scores, corrections and event boundaries', () => {
 const point = { timeMs: 1000, groupId: 'g', eventId: 'e', vehicleId: 7, latitude: 32, longitude: 34, sync: 90 };
 const rows = trace.mergeScoreTrace([point], [{ ...point, sync: 40 }, { ...point, timeMs: 6000 }, { ...point, timeMs: 30000 }, { ...point, timeMs: 35000, eventId: 'new' }]);
 assert.equal(rows.length, 4); assert.equal(rows[0].sync, 40);
 assert.equal(trace.traceSegments(rows).length, 1);
 assert.equal(trace.traceScoreColor(null), '#88939f');
});
test('SI symmetry preserves type and ring while removing rotation and reflection', () => {
 const a = { family: 'SI', mix: '', constellation: '', values: [], siPositions: [{typeId:'a',ring:'inner',angleDeg:0},{typeId:'b',ring:'outer',angleDeg:120}] };
 const b = {...a, siPositions:a.siPositions.map(s => ({...s,angleDeg:(330-s.angleDeg+360)%360}))};
 assert.equal(model.canonicalTemplateKey(a), model.canonicalTemplateKey(b));
 const c = {...a, siPositions:a.siPositions.map(s => ({...s,ring:'middle'}))};
 assert.notEqual(model.canonicalTemplateKey(a), model.canonicalTemplateKey(c));
});
