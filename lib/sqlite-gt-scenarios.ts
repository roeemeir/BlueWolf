import type { DatabaseSync } from "node:sqlite";

import { normalizeGtScenario, gtScenarioSummary, type GtScenario } from "@/lib/gt-scenario-contract";
import { applyLocalSchemaMigrations } from "@/lib/sqlite-migrations";

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

function rowScenario(row: Record<string, unknown>): GtScenario {
  const parsed = JSON.parse(String(row.state)) as Record<string, unknown>;
  return normalizeGtScenario({
    ...parsed,
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  });
}

export async function listLocalGtScenarios(options: { query?: string; serverId?: string; limit?: number; offset?: number } = {}) {
  const db = await database();
  const query = (options.query ?? "").trim().slice(0, 120);
  const serverId = (options.serverId ?? "").trim().slice(0, 120);
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 100)));
  const offset = Math.max(0, Math.min(100_000, Math.trunc(options.offset ?? 0)));
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (query) { conditions.push("name LIKE ? COLLATE NOCASE"); args.push(`%${query}%`); }
  if (serverId) { conditions.push("server_id=?"); args.push(serverId); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT id,name,server_id,arena,start_at,end_at,group_count,revision,created_at,updated_at FROM gt_scenarios ${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM gt_scenarios ${where}`).get(...args);
  return {
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
    items: rows.map((row) => ({
      id: String(row.id), name: String(row.name), serverId: String(row.server_id), arena: String(row.arena),
      startAt: String(row.start_at), endAt: String(row.end_at), groupCount: Number(row.group_count),
      revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    })),
  };
}

export async function readLocalGtScenario(id: string) {
  const db = await database();
  const row = db.prepare("SELECT * FROM gt_scenarios WHERE id=?").get(id);
  return row ? rowScenario(row) : null;
}

export async function writeLocalGtScenario(value: unknown, expectedRevision?: number) {
  const normalized = normalizeGtScenario(value);
  const db = await database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT revision,created_at FROM gt_scenarios WHERE id=?").get(normalized.id);
    const currentRevision = Number(existing?.revision ?? 0);
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      db.exec("ROLLBACK");
      return { conflict: true, revision: currentRevision };
    }
    const nextRevision = currentRevision + 1;
    const state = JSON.stringify({ ...normalized, revision: nextRevision, createdAt: undefined, updatedAt: undefined });
    db.prepare(`INSERT INTO gt_scenarios(id,name,server_id,arena,start_at,end_at,group_count,state,revision)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,server_id=excluded.server_id,arena=excluded.arena,start_at=excluded.start_at,end_at=excluded.end_at,
        group_count=excluded.group_count,state=excluded.state,revision=excluded.revision,updated_at=CURRENT_TIMESTAMP`)
      .run(normalized.id, normalized.name, normalized.serverId, normalized.arena, normalized.startAt, normalized.endAt, normalized.groups.length, state, nextRevision);
    db.prepare("INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES('installation','gt-scenario',?,?)")
      .run(existing ? "update" : "create", `${normalized.id}: ${normalized.name} · ${normalized.groups.length} groups`.slice(0, 500));
    db.exec("COMMIT");
    const saved = await readLocalGtScenario(normalized.id);
    if (!saved) throw new Error("saved GT scenario could not be reloaded");
    return { ok: true, revision: nextRevision, scenario: saved, summary: gtScenarioSummary(saved), storage: "sqlite" };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  }
}

export async function deleteLocalGtScenario(id: string, expectedRevision?: number) {
  const db = await database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT revision,name FROM gt_scenarios WHERE id=?").get(id);
    if (!row) { db.exec("ROLLBACK"); return { notFound: true }; }
    const revision = Number(row.revision);
    if (expectedRevision !== undefined && revision !== expectedRevision) { db.exec("ROLLBACK"); return { conflict: true, revision }; }
    db.prepare("DELETE FROM gt_scenarios WHERE id=?").run(id);
    db.prepare("INSERT INTO audit_entries(workspace_id,category,action,detail) VALUES('installation','gt-scenario','delete',?)")
      .run(`${id}: ${String(row.name)}`.slice(0, 500));
    db.exec("COMMIT");
    return { ok: true, id, storage: "sqlite" };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  }
}
