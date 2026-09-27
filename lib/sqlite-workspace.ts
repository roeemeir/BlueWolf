// Local deployment only. The hosted preview keeps its separate D1 adapter.
import type { DatabaseSync } from "node:sqlite";

import { applyLocalSchemaMigrations } from "@/lib/sqlite-migrations";

export type WorkspaceScopeType = "server" | "group";

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
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    applyLocalSchemaMigrations(db);
    return db;
  })().catch((error) => { connection = undefined; throw error; });
  return connection;
}

function normalizedScope(scopeType: WorkspaceScopeType, scopeId: string) {
  if (scopeType !== "server" && scopeType !== "group") throw new Error("scope type must be server or group");
  const id = scopeId.trim();
  if (!/^[A-Za-z0-9_.:@-]{1,160}$/.test(id)) throw new Error("scope id contains unsupported characters");
  return { scopeType, scopeId: id };
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

export async function readLocalWorkspaceScope(workspaceId: string, scopeType: WorkspaceScopeType, rawScopeId: string) {
  const { scopeId } = normalizedScope(scopeType, rawScopeId);
  const db = await database();
  const row = db.prepare(`SELECT state,revision,updated_at AS updatedAt
    FROM workspace_scopes WHERE workspace_id=? AND scope_type=? AND scope_id=?`).get(workspaceId, scopeType, scopeId);
  if (!row) return { state: null, revision: 0, updatedAt: null, scopeType, scopeId, storage: "sqlite" };
  return { state: JSON.parse(String(row.state)), revision: Number(row.revision), updatedAt: row.updatedAt ?? null, scopeType, scopeId, storage: "sqlite" };
}

export async function listLocalWorkspaceScopeVersions(workspaceId: string, scopeType: WorkspaceScopeType, rawScopeId: string, limit = 30) {
  const { scopeId } = normalizedScope(scopeType, rawScopeId);
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const db = await database();
  return db.prepare(`SELECT revision,category,action,detail,created_at AS createdAt
    FROM workspace_scope_versions
    WHERE workspace_id=? AND scope_type=? AND scope_id=?
    ORDER BY revision DESC LIMIT ?`).all(workspaceId, scopeType, scopeId, bounded);
}

export async function writeLocalWorkspaceScope(
  workspaceId: string,
  scopeType: WorkspaceScopeType,
  rawScopeId: string,
  state: string,
  category: string,
  action: string,
  detail: string,
  expectedRevision?: number,
) {
  const { scopeId } = normalizedScope(scopeType, rawScopeId);
  // Parse before taking the lock so malformed state can never create a revision.
  JSON.parse(state);
  const db = await database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(`SELECT revision FROM workspace_scopes
      WHERE workspace_id=? AND scope_type=? AND scope_id=?`).get(workspaceId, scopeType, scopeId);
    const revision = Number(row?.revision ?? 0);
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      db.exec("ROLLBACK");
      return { conflict: true, revision, scopeType, scopeId };
    }
    const nextRevision = revision + 1;
    db.prepare(`INSERT INTO workspace_scopes(workspace_id,scope_type,scope_id,state,revision)
      VALUES(?,?,?,?,?)
      ON CONFLICT(workspace_id,scope_type,scope_id) DO UPDATE SET
        state=excluded.state,revision=excluded.revision,updated_at=CURRENT_TIMESTAMP`)
      .run(workspaceId, scopeType, scopeId, state, nextRevision);
    db.prepare(`INSERT INTO workspace_scope_versions(
      workspace_id,scope_type,scope_id,revision,state,category,action,detail
    ) VALUES(?,?,?,?,?,?,?,?)`).run(workspaceId, scopeType, scopeId, nextRevision, state, category, action, detail);
    db.prepare("INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES(?,?,?,?)")
      .run(workspaceId, `scope-${scopeType}`.slice(0, 40), action.slice(0, 80), `${scopeId}: ${detail}`.slice(0, 500));
    db.exec("COMMIT");
    return { ok: true, revision: nextRevision, scopeType, scopeId, storage: "sqlite" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
