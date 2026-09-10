import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import {
  drizzle,
  type AsyncBatchRemoteCallback,
  type AsyncRemoteCallback,
} from "drizzle-orm/sqlite-proxy";

import { BLUEWOLF_MIGRATIONS } from "./migrations";
import * as schema from "./schema";

type SqliteValue = null | number | bigint | string | Uint8Array;
type SqliteRow = Record<string, SqliteValue>;
type QueryMethod = "run" | "all" | "values" | "get";

type LocalDatabaseState = {
  path: string;
  sqlite: DatabaseSync;
  orm: ReturnType<typeof createOrm>;
};

const MIGRATION_TABLE = "__bluewolf_migrations";

function configuredDatabasePath() {
  const configured = process.env.BLUEWOLF_SQLITE_PATH?.trim();
  if (!configured) return join(process.cwd(), "data", "bluewolf.sqlite");
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function normalizedParams(params: unknown[]): SqliteValue[] {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "string" ||
      value instanceof Uint8Array
    ) return value;
    throw new TypeError(`Unsupported SQLite parameter type: ${typeof value}`);
  });
}

function rowValues(row: unknown): unknown[] {
  return row && typeof row === "object" ? Object.values(row as SqliteRow) : [];
}

function executeStatement(
  sqlite: DatabaseSync,
  sql: string,
  params: unknown[],
  method: QueryMethod,
): { rows: unknown[] } {
  const statement: StatementSync = sqlite.prepare(sql);
  const values = normalizedParams(params);
  if (method === "run") {
    statement.run(...values);
    return { rows: [] };
  }
  if (method === "get") {
    const row = statement.get(...values);
    return { rows: row ? rowValues(row) : [] };
  }
  const rows = statement.all(...values);
  return { rows: rows.map(rowValues) };
}

function ensureAuditColumns(sqlite: DatabaseSync) {
  const columns = new Set(
    (sqlite.prepare("PRAGMA table_info(audit_entries)").all() as Array<{ name?: string }>)
      .map((row) => row.name)
      .filter((name): name is string => Boolean(name)),
  );
  const required: Array<[string, string]> = [
    ["entity_type", "text"],
    ["entity_id", "text"],
    ["config_version", "integer"],
    ["algorithm_version", "text"],
  ];
  for (const [name, type] of required) {
    if (!columns.has(name)) sqlite.exec(`ALTER TABLE audit_entries ADD COLUMN ${name} ${type}`);
  }
}

function migrate(sqlite: DatabaseSync) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id text PRIMARY KEY NOT NULL,
      applied_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);
  const appliedStatement = sqlite.prepare(`SELECT id FROM ${MIGRATION_TABLE}`);
  const applied = new Set(
    (appliedStatement.all() as Array<{ id?: string }>).map((row) => row.id).filter((id): id is string => Boolean(id)),
  );
  const recordMigration = sqlite.prepare(`INSERT INTO ${MIGRATION_TABLE} (id) VALUES (?)`);

  for (const migration of BLUEWOLF_MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      if (migration.id === "0002_audit_provenance_columns") ensureAuditColumns(sqlite);
      else sqlite.exec(migration.sql);
      recordMigration.run(migration.id);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function createOrm(sqlite: DatabaseSync) {
  const query: AsyncRemoteCallback = async (sql, params, method) =>
    executeStatement(sqlite, sql, params, method);

  const batch: AsyncBatchRemoteCallback = async (queries) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = queries.map((item) => executeStatement(sqlite, item.sql, item.params, item.method));
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  };

  return drizzle(query, batch, { schema });
}

function openLocalDatabase(path: string): LocalDatabaseState {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  sqlite.exec("PRAGMA journal_mode=WAL");
  sqlite.exec("PRAGMA synchronous=NORMAL");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec("PRAGMA busy_timeout=5000");
  migrate(sqlite);
  return { path, sqlite, orm: createOrm(sqlite) };
}

const globalState = globalThis as typeof globalThis & {
  __bluewolfLocalDatabase?: LocalDatabaseState;
};

export function getDb() {
  const path = configuredDatabasePath();
  const current = globalState.__bluewolfLocalDatabase;
  if (current?.path === path) return current.orm;
  if (current) current.sqlite.close();
  const next = openLocalDatabase(path);
  globalState.__bluewolfLocalDatabase = next;
  return next.orm;
}

export function getSqlitePath() {
  return configuredDatabasePath();
}

/** Test/support hook. The production server normally keeps one connection open. */
export function closeDb() {
  const current = globalState.__bluewolfLocalDatabase;
  if (!current) return;
  current.sqlite.close();
  delete globalState.__bluewolfLocalDatabase;
}
