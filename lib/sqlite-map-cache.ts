import type { DatabaseSync } from "node:sqlite";

import { applyLocalSchemaMigrations } from "@/lib/sqlite-migrations";

const DEFAULT_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_TILE_BYTES = 12 * 1024 * 1024;
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

function cacheLimitBytes() {
  const configured = Number(process.env.BLUEWOLF_MAP_CACHE_MAX_BYTES ?? DEFAULT_CACHE_BYTES);
  if (!Number.isFinite(configured) || configured < 16 * 1024 * 1024) return DEFAULT_CACHE_BYTES;
  return Math.trunc(configured);
}

function validateKey(cacheKey: string) {
  if (!cacheKey || cacheKey.length > 512) throw new Error("map cache key is invalid");
  return cacheKey;
}

export async function readLocalMapTile(cacheKey: string) {
  const db = await database();
  const key = validateKey(cacheKey);
  const row = db.prepare("SELECT source_id AS sourceId,content_type AS contentType,body,byte_length AS byteLength,updated_at AS updatedAt FROM map_tile_cache WHERE cache_key=?").get(key);
  if (!row) return null;
  db.prepare("UPDATE map_tile_cache SET last_accessed_at=CURRENT_TIMESTAMP WHERE cache_key=?").run(key);
  const body = row.body;
  if (!(body instanceof Uint8Array)) throw new Error("cached map body is invalid");
  return {
    sourceId: String(row.sourceId),
    contentType: String(row.contentType),
    body,
    byteLength: Number(row.byteLength),
    updatedAt: String(row.updatedAt),
  };
}

export async function writeLocalMapTile(cacheKey: string, sourceId: string, contentType: string, body: Uint8Array) {
  const key = validateKey(cacheKey);
  if (!sourceId || sourceId.length > 80) throw new Error("map cache source id is invalid");
  if (!contentType.startsWith("image/")) throw new Error("map cache accepts image content only");
  if (!body.byteLength || body.byteLength > MAX_TILE_BYTES) throw new Error("map cache tile size is invalid");
  const db = await database();
  db.prepare(`INSERT INTO map_tile_cache(cache_key,source_id,content_type,body,byte_length)
    VALUES(?,?,?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET
      source_id=excluded.source_id,content_type=excluded.content_type,body=excluded.body,byte_length=excluded.byte_length,
      updated_at=CURRENT_TIMESTAMP,last_accessed_at=CURRENT_TIMESTAMP`)
    .run(key, sourceId, contentType, body, body.byteLength);
  pruneMapCache(db, cacheLimitBytes());
  return { ok: true, cacheKey: key, byteLength: body.byteLength };
}

function pruneMapCache(db: DatabaseSync, maxBytes: number) {
  let total = Number(db.prepare("SELECT COALESCE(SUM(byte_length),0) AS total FROM map_tile_cache").get()?.total ?? 0);
  while (total > maxBytes) {
    const victims = db.prepare("SELECT cache_key,byte_length FROM map_tile_cache ORDER BY last_accessed_at ASC,updated_at ASC LIMIT 64").all();
    if (!victims.length) break;
    const remove = db.prepare("DELETE FROM map_tile_cache WHERE cache_key=?");
    for (const victim of victims) {
      remove.run(String(victim.cache_key));
      total -= Number(victim.byte_length ?? 0);
      if (total <= maxBytes) break;
    }
  }
}

export async function mapCacheStats() {
  const db = await database();
  const row = db.prepare("SELECT COUNT(*) AS entries,COALESCE(SUM(byte_length),0) AS bytes,MAX(updated_at) AS newest FROM map_tile_cache").get();
  return { entries: Number(row?.entries ?? 0), bytes: Number(row?.bytes ?? 0), newest: row?.newest ? String(row.newest) : null, limitBytes: cacheLimitBytes() };
}
