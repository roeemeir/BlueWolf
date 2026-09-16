import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { after } from 'node:test';
import { createServer } from 'vite';

const root = process.cwd();
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const migrations = await vite.ssrLoadModule('/lib/sqlite-migrations.ts');

async function withDatabase(fn) {
  const directory = await mkdtemp(path.join(tmpdir(), 'bluewolf-migration-'));
  const filename = path.join(directory, 'legacy.sqlite');
  const db = new DatabaseSync(filename);
  try { return await fn(db, filename); }
  finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}

test('BW-OFF-012 upgrades a legacy workspace without losing state, revision or audit evidence', async () => {
  await withDatabase((db) => {
    db.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
        category TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare('INSERT INTO workspaces(id,state,revision) VALUES(?,?,?)').run('legacy', JSON.stringify({ legacy: true, value: 42 }), 3);
    db.prepare('INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES(?,?,?,?)').run('legacy', 'legacy', 'save', 'before migrations');

    assert.deepEqual(migrations.applyLocalSchemaMigrations(db), [
      '000-workspace-base',
      '001-workspace-version-history',
      '002-map-source-secrets',
    ]);

    const workspace = db.prepare('SELECT state,revision FROM workspaces WHERE id=?').get('legacy');
    assert.equal(workspace.revision, 3);
    assert.deepEqual(JSON.parse(String(workspace.state)), { legacy: true, value: 42 });
    const audit = db.prepare('SELECT category,action,detail FROM audit_entries WHERE workspace_id=?').all('legacy');
    assert.deepEqual(audit, [{ category: 'legacy', action: 'save', detail: 'before migrations' }]);
    const version = db.prepare('SELECT revision,state,category,action FROM workspace_versions WHERE workspace_id=?').get('legacy');
    assert.equal(version.revision, 3);
    assert.deepEqual(JSON.parse(String(version.state)), { legacy: true, value: 42 });
    assert.equal(version.category, 'migration');
    assert.equal(version.action, 'snapshot');

    assert.deepEqual(migrations.applyLocalSchemaMigrations(db), [], 'second startup must be idempotent');
    const ledger = db.prepare('SELECT id FROM local_schema_migrations ORDER BY id').all().map((row) => String(row.id));
    assert.deepEqual(ledger, migrations.localSchemaMigrationIds());
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)));
    assert.ok(tables.has('workspace_versions'));
    assert.ok(tables.has('map_source_secrets'));
  });
});

test('BW-OFF-012 adopts databases that already carry the older 001/002 migration markers', async () => {
  await withDatabase((db) => {
    db.exec(`
      CREATE TABLE local_schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE audit_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE workspace_versions (workspace_id TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(workspace_id,revision));
      CREATE TABLE map_source_secrets (workspace_id TEXT NOT NULL, source_id TEXT NOT NULL, token TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(workspace_id,source_id));
      INSERT INTO local_schema_migrations(id) VALUES('001-workspace-version-history'),('002-map-source-secrets');
    `);
    assert.deepEqual(migrations.applyLocalSchemaMigrations(db), ['000-workspace-base']);
    assert.deepEqual(migrations.applyLocalSchemaMigrations(db), []);
    const ledger = db.prepare('SELECT id FROM local_schema_migrations ORDER BY id').all().map((row) => String(row.id));
    assert.deepEqual(ledger, migrations.localSchemaMigrationIds());
  });
});
