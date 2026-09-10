export type BlueWolfMigration = {
  id: string;
  sql: string;
};

/**
 * Embedded on purpose: the standalone Windows/OpenShift runtime must be able to
 * bootstrap a fresh database without depending on a source checkout, Wrangler,
 * a migration service, or internet access.
 */
export const BLUEWOLF_MIGRATIONS: readonly BlueWolfMigration[] = [
  {
    id: "0000_workspace_audit",
    sql: `
CREATE TABLE IF NOT EXISTS audit_entries (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  workspace_id text NOT NULL,
  category text NOT NULL,
  action text NOT NULL,
  detail text DEFAULT '' NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY NOT NULL,
  state text DEFAULT '{}' NOT NULL,
  revision integer DEFAULT 1 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
`,
  },
  {
    id: "0001_bluewolf_domain",
    sql: `
CREATE TABLE IF NOT EXISTS app_settings (
  workspace_id text PRIMARY KEY NOT NULL,
  active_config_version integer,
  draft_config_version integer,
  timezone text DEFAULT 'Asia/Jerusalem' NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS config_versions (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  workspace_id text NOT NULL,
  version integer NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  value text DEFAULT '{}' NOT NULL,
  algorithm_version text,
  created_by text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  published_at text
);
CREATE UNIQUE INDEX IF NOT EXISTS config_versions_workspace_version_uq
  ON config_versions (workspace_id, version);
CREATE TABLE IF NOT EXISTS gt_scenarios (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL,
  name text DEFAULT '' NOT NULL,
  server_id text NOT NULL,
  arena text,
  start_utc text NOT NULL,
  end_utc text NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  manual_score integer,
  notes text DEFAULT '' NOT NULL,
  config_version integer,
  algorithm_version text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS gt_scenario_groups (
  id text PRIMARY KEY NOT NULL,
  scenario_id text NOT NULL,
  group_id text NOT NULL,
  family text NOT NULL,
  members_json text DEFAULT '[]' NOT NULL,
  vehicle_types_json text DEFAULT '{}' NOT NULL,
  route_geometry_json text DEFAULT '{}' NOT NULL,
  sync_rules_json text DEFAULT '{}' NOT NULL,
  score_profile_json text DEFAULT '{}' NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS gt_scenario_groups_scenario_group_uq
  ON gt_scenario_groups (scenario_id, group_id);
CREATE TABLE IF NOT EXISTS ground_truth_labels (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  workspace_id text NOT NULL,
  scenario_id text,
  group_id text NOT NULL,
  layer text NOT NULL,
  score integer NOT NULL,
  quality text,
  start_utc text,
  end_utc text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS event_config_overrides (
  id text PRIMARY KEY NOT NULL,
  workspace_id text NOT NULL,
  event_key text NOT NULL,
  group_id text NOT NULL,
  config_json text DEFAULT '{}' NOT NULL,
  reason text NOT NULL,
  approver text,
  approval_status text DEFAULT 'draft' NOT NULL,
  apply_mode text DEFAULT 'now' NOT NULL,
  config_version integer,
  algorithm_version text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
`,
  },
  {
    id: "0002_audit_provenance_columns",
    sql: `
ALTER TABLE audit_entries ADD COLUMN entity_type text;
ALTER TABLE audit_entries ADD COLUMN entity_id text;
ALTER TABLE audit_entries ADD COLUMN config_version integer;
ALTER TABLE audit_entries ADD COLUMN algorithm_version text;
`,
  },
] as const;
