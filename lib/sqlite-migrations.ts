import type { DatabaseSync } from "node:sqlite";

export type LocalSchemaMigration = {
  id: string;
  apply: (db: DatabaseSync) => void;
};

const MIGRATIONS: readonly LocalSchemaMigration[] = [
  {
    id: "000-workspace-base",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          revision INTEGER NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS audit_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id TEXT NOT NULL,
          category TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS audit_workspace ON audit_entries(workspace_id,id);
      `);
    },
  },
  {
    id: "001-workspace-version-history",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_versions (
          workspace_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          state TEXT NOT NULL,
          category TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(workspace_id, revision)
        );
        CREATE INDEX IF NOT EXISTS workspace_versions_recent
          ON workspace_versions(workspace_id, revision DESC);
        INSERT OR IGNORE INTO workspace_versions(workspace_id,revision,state,category,action,detail,created_at)
          SELECT id,revision,state,'migration','snapshot','Backfilled current workspace during version-history migration',updated_at
          FROM workspaces WHERE revision > 0;
      `);
    },
  },
  {
    id: "002-map-source-secrets",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS map_source_secrets (
          workspace_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          token TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(workspace_id, source_id)
        );
      `);
    },
  },
] as const;

function ensureMigrationLedger(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function localSchemaMigrationIds() {
  return MIGRATIONS.map((migration) => migration.id);
}

export function applyLocalSchemaMigrations(db: DatabaseSync) {
  ensureMigrationLedger(db);
  const applied = new Set(
    db.prepare("SELECT id FROM local_schema_migrations").all().map((row) => String(row.id)),
  );

  const appliedNow: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.apply(db);
      db.prepare("INSERT INTO local_schema_migrations(id) VALUES(?)").run(migration.id);
      db.exec("COMMIT");
      applied.add(migration.id);
      appliedNow.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`SQLite migration ${migration.id} failed`, { cause: error });
    }
  }
  return appliedNow;
}
