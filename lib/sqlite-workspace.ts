// Local deployment only. The hosted preview keeps its separate D1 adapter.
import type { DatabaseSync } from "node:sqlite";

let connection: Promise<DatabaseSync> | undefined;

async function database() {
  connection ??= (async () => {
    const sqliteModule = "node:sqlite";
    const fsModule = "node:fs";
    const pathModule = "node:path";
    const { DatabaseSync } = await import(/* webpackIgnore: true */ /* @vite-ignore */ sqliteModule);
    const fs = await import(/* webpackIgnore: true */ /* @vite-ignore */ fsModule);
    const path = await import(/* webpackIgnore: true */ /* @vite-ignore */ pathModule);
    const filename = path.resolve(process.env.BLUEWOLF_SQLITE_PATH ?? "data/bluewolf.sqlite");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db: DatabaseSync = new DatabaseSync(filename);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS local_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
        category TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS audit_workspace ON audit_entries(workspace_id,id);
      CREATE TABLE IF NOT EXISTS workspace_versions (
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(workspace_id, revision));
      CREATE INDEX IF NOT EXISTS workspace_versions_recent
        ON workspace_versions(workspace_id, revision DESC);
      INSERT OR IGNORE INTO workspace_versions(workspace_id,revision,state,category,action,detail,created_at)
        SELECT id,revision,state,'migration','snapshot','Backfilled current workspace during version-history migration',updated_at
        FROM workspaces WHERE revision > 0;
      INSERT OR IGNORE INTO local_schema_migrations(id) VALUES('001-workspace-version-history');
      CREATE TABLE IF NOT EXISTS map_source_secrets (
        workspace_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        token TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(workspace_id, source_id));
      INSERT OR IGNORE INTO local_schema_migrations(id) VALUES('002-map-source-secrets');`);
    return db;
  })().catch((error) => { connection = undefined; throw error; });
  return connection;
}

export async function readLocalWorkspace(id: string) {
  const db = await database();
  const row = db.prepare("SELECT * FROM workspaces WHERE id=?").get(id);
  const logs = db.prepare("SELECT id,category,action,detail,created_at AS createdAt FROM audit_entries WHERE workspace_id=? ORDER BY id DESC LIMIT 20").all(id);
  return { state: row ? JSON.parse(String(row.state)) : null, revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null, logs, storage: "sqlite" };
}

export async function listLocalWorkspaceVersions(id: string, limit = 30) {
  const db = await database();
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  return db.prepare(`SELECT revision,category,action,detail,created_at AS createdAt
    FROM workspace_versions WHERE workspace_id=? ORDER BY revision DESC LIMIT ?`).all(id, bounded);
}

export async function readLocalWorkspaceVersion(id: string, revision: number) {
  if (!Number.isInteger(revision) || revision < 1) throw new Error("revision must be a positive integer");
  const db = await database();
  const row = db.prepare(`SELECT revision,state,category,action,detail,created_at AS createdAt
    FROM workspace_versions WHERE workspace_id=? AND revision=?`).get(id, revision);
  if (!row) return null;
  return { ...row, state: JSON.parse(String(row.state)) };
}

export async function readLocalMapSourceToken(workspaceId: string, sourceId: string) {
  const db = await database();
  const row = db.prepare("SELECT token FROM map_source_secrets WHERE workspace_id=? AND source_id=?").get(workspaceId, sourceId);
  return row ? String(row.token) : null;
}

export async function hasLocalMapSourceToken(workspaceId: string, sourceId: string) {
  const db = await database();
  const row = db.prepare("SELECT 1 AS present FROM map_source_secrets WHERE workspace_id=? AND source_id=?").get(workspaceId, sourceId);
  return Boolean(row);
}

export async function writeLocalMapSourceToken(workspaceId: string, sourceId: string, token: string) {
  const normalized = token.trim();
  if (!normalized) throw new Error("map source token must not be empty");
  if (normalized.length > 4096) throw new Error("map source token is too large");
  const db = await database();
  db.prepare(`INSERT INTO map_source_secrets(workspace_id,source_id,token)
    VALUES(?,?,?)
    ON CONFLICT(workspace_id,source_id) DO UPDATE SET token=excluded.token,updated_at=CURRENT_TIMESTAMP`).run(workspaceId, sourceId, normalized);
  db.prepare("INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES(?,?,?,?)")
    .run(workspaceId, "map-source", "set-token", `token updated for ${sourceId}`);
  return { ok: true, sourceId, configured: true, storage: "sqlite" };
}

export async function deleteLocalMapSourceToken(workspaceId: string, sourceId: string) {
  const db = await database();
  db.prepare("DELETE FROM map_source_secrets WHERE workspace_id=? AND source_id=?").run(workspaceId, sourceId);
  db.prepare("INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES(?,?,?,?)")
    .run(workspaceId, "map-source", "delete-token", `token removed for ${sourceId}`);
  return { ok: true, sourceId, configured: false, storage: "sqlite" };
}

export async function listLocalSchemaMigrations() {
  const db = await database();
  return db.prepare("SELECT id,applied_at AS appliedAt FROM local_schema_migrations ORDER BY applied_at ASC,id ASC").all();
}

function currentRevision(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT revision FROM workspaces WHERE id=?").get(id);
  return Number(row?.revision ?? 0);
}

function commitVersion(
  db: DatabaseSync,
  id: string,
  state: string,
  revision: number,
  category: string,
  action: string,
  detail: string,
) {
  db.prepare("INSERT INTO workspaces(id,state,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,updated_at=CURRENT_TIMESTAMP").run(id, state, revision);
  db.prepare("INSERT INTO workspace_versions(workspace_id,revision,state,category,action,detail) VALUES(?,?,?,?,?,?)").run(id, revision, state, category, action, detail);
  db.prepare("INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES(?,?,?,?)").run(id, category, action, detail);
}

export async function writeLocalWorkspace(id: string, state: string, category: string, action: string, detail: string, expectedRevision?: number) {
  const db = await database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const revision = currentRevision(db, id);
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      db.exec("ROLLBACK");
      return { conflict: true, revision };
    }
    const nextRevision = revision + 1;
    commitVersion(db, id, state, nextRevision, category, action, detail);
    db.exec("COMMIT");
    return { ok: true, revision: nextRevision, storage: "sqlite" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function restoreLocalWorkspaceVersion(id: string, sourceRevision: number, expectedRevision?: number) {
  if (!Number.isInteger(sourceRevision) || sourceRevision < 1) throw new Error("source revision must be a positive integer");
  const db = await database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const revision = currentRevision(db, id);
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      db.exec("ROLLBACK");
      return { conflict: true, revision };
    }
    const source = db.prepare("SELECT state FROM workspace_versions WHERE workspace_id=? AND revision=?").get(id, sourceRevision);
    if (!source) {
      db.exec("ROLLBACK");
      return { notFound: true, revision };
    }
    const nextRevision = revision + 1;
    commitVersion(db, id, String(source.state), nextRevision, "recovery", "restore-version", `restored from revision ${sourceRevision}`);
    db.exec("COMMIT");
    return { ok: true, revision: nextRevision, restoredFrom: sourceRevision, storage: "sqlite" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
