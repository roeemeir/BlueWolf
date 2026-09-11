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
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS audit_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
        category TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS audit_workspace ON audit_entries(workspace_id,id);`);
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

export async function writeLocalWorkspace(id: string, state: string, category: string, action: string, detail: string, expectedRevision?: number) {
  const db = await database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT revision FROM workspaces WHERE id=?").get(id);
    const revision = Number(row?.revision ?? 0);
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      db.exec("ROLLBACK");
      return { conflict: true, revision };
    }
    db.prepare("INSERT INTO workspaces(id,state,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=excluded.revision,updated_at=CURRENT_TIMESTAMP").run(id, state, revision + 1);
    db.prepare("INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES(?,?,?,?)").run(id, category, action, detail);
    db.exec("COMMIT");
    return { ok: true, revision: revision + 1, storage: "sqlite" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
