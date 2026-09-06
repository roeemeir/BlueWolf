import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  state: text("state").notNull().default("{}"),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEntries = sqliteTable("audit_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  category: text("category").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Small recovery snapshots for the canonical Python CoreSession.
 * Navigation itself is NOT stored here; Influx remains the NAV source of truth.
 */
export const coreCheckpoints = sqliteTable("core_checkpoints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  serverId: text("server_id").notNull(),
  coreApiVersion: text("core_api_version").notNull(),
  algorithmVersion: text("algorithm_version").notNull(),
  processedUntilUtc: text("processed_until_utc"),
  checkpointBase64: text("checkpoint_base64").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
