import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Workspace state remains a convenient UI/bootstrap snapshot. It is deliberately
 * not the only persistence model: domain entities below retain their own identity,
 * history and provenance as required by the Blue Wolf SRS.
 */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  state: text("state").notNull().default("{}"),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  workspaceId: text("workspace_id").primaryKey(),
  activeConfigVersion: integer("active_config_version"),
  draftConfigVersion: integer("draft_config_version"),
  timezone: text("timezone").notNull().default("Asia/Jerusalem"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const configVersions = sqliteTable("config_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  version: integer("version").notNull(),
  status: text("status", { enum: ["draft", "published", "superseded"] }).notNull().default("draft"),
  value: text("value").notNull().default("{}"),
  algorithmVersion: text("algorithm_version"),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  publishedAt: text("published_at"),
}, (table) => [
  uniqueIndex("config_versions_workspace_version_uq").on(table.workspaceId, table.version),
]);

export const gtScenarios = sqliteTable("gt_scenarios", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull().default(""),
  serverId: text("server_id").notNull(),
  arena: text("arena"),
  startUtc: text("start_utc").notNull(),
  endUtc: text("end_utc").notNull(),
  status: text("status", { enum: ["draft", "approved", "archived"] }).notNull().default("draft"),
  manualScore: integer("manual_score"),
  notes: text("notes").notNull().default(""),
  configVersion: integer("config_version"),
  algorithmVersion: text("algorithm_version"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const gtScenarioGroups = sqliteTable("gt_scenario_groups", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  groupId: text("group_id").notNull(),
  family: text("family", { enum: ["SI", "SO", "FREE"] }).notNull(),
  membersJson: text("members_json").notNull().default("[]"),
  vehicleTypesJson: text("vehicle_types_json").notNull().default("{}"),
  routeGeometryJson: text("route_geometry_json").notNull().default("{}"),
  syncRulesJson: text("sync_rules_json").notNull().default("{}"),
  scoreProfileJson: text("score_profile_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("gt_scenario_groups_scenario_group_uq").on(table.scenarioId, table.groupId),
]);

/** Legacy/compatibility labels are retained because older validated GT packages
 * used flat labels. New GT should be written through gt_scenarios/groups. */
export const groundTruthLabels = sqliteTable("ground_truth_labels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  scenarioId: text("scenario_id"),
  groupId: text("group_id").notNull(),
  layer: text("layer", { enum: ["sync", "route", "total"] }).notNull(),
  score: integer("score").notNull(),
  quality: text("quality", { enum: ["good", "medium", "low"] }),
  startUtc: text("start_utc"),
  endUtc: text("end_utc"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const eventConfigOverrides = sqliteTable("event_config_overrides", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  eventKey: text("event_key").notNull(),
  groupId: text("group_id").notNull(),
  configJson: text("config_json").notNull().default("{}"),
  reason: text("reason").notNull(),
  approver: text("approver"),
  approvalStatus: text("approval_status", { enum: ["draft", "approved", "rejected"] }).notNull().default("draft"),
  applyMode: text("apply_mode", { enum: ["now", "event-start"] }).notNull().default("now"),
  configVersion: integer("config_version"),
  algorithmVersion: text("algorithm_version"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditEntries = sqliteTable("audit_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  category: text("category").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  configVersion: integer("config_version"),
  algorithmVersion: text("algorithm_version"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
