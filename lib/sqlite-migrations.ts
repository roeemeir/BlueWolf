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
  {
    id: "003-scoped-settings",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspace_scopes (
          workspace_id TEXT NOT NULL,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('server','group')),
          scope_id TEXT NOT NULL,
          state TEXT NOT NULL,
          revision INTEGER NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(workspace_id, scope_type, scope_id)
        );
        CREATE TABLE IF NOT EXISTS workspace_scope_versions (
          workspace_id TEXT NOT NULL,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('server','group')),
          scope_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          state TEXT NOT NULL,
          category TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(workspace_id, scope_type, scope_id, revision)
        );
        CREATE INDEX IF NOT EXISTS workspace_scope_versions_recent
          ON workspace_scope_versions(workspace_id, scope_type, scope_id, revision DESC);
      `);
    },
  },
  {
    id: "004-map-tile-cache",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS map_tile_cache (
          cache_key TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          content_type TEXT NOT NULL,
          body BLOB NOT NULL,
          byte_length INTEGER NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS map_tile_cache_source_recent
          ON map_tile_cache(source_id,last_accessed_at DESC);
        CREATE INDEX IF NOT EXISTS map_tile_cache_lru
          ON map_tile_cache(last_accessed_at ASC);
      `);
    },
  },
  {
    id: "005-gt-scenarios",
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS gt_scenarios (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          server_id TEXT NOT NULL,
          arena TEXT NOT NULL,
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          group_count INTEGER NOT NULL,
          state TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS gt_scenarios_recent
          ON gt_scenarios(updated_at DESC,id);
        CREATE INDEX IF NOT EXISTS gt_scenarios_server
          ON gt_scenarios(server_id,updated_at DESC);
        CREATE INDEX IF NOT EXISTS gt_scenarios_name
          ON gt_scenarios(name COLLATE NOCASE);
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
