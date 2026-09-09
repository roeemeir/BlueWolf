CREATE TABLE `app_settings` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `active_config_version` integer,
  `draft_config_version` integer,
  `timezone` text DEFAULT 'Asia/Jerusalem' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config_versions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `workspace_id` text NOT NULL,
  `version` integer NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `value` text DEFAULT '{}' NOT NULL,
  `algorithm_version` text,
  `created_by` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `published_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_versions_workspace_version_uq` ON `config_versions` (`workspace_id`,`version`);
--> statement-breakpoint
CREATE TABLE `gt_scenarios` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `server_id` text NOT NULL,
  `arena` text,
  `start_utc` text NOT NULL,
  `end_utc` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `manual_score` integer,
  `notes` text DEFAULT '' NOT NULL,
  `config_version` integer,
  `algorithm_version` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gt_scenario_groups` (
  `id` text PRIMARY KEY NOT NULL,
  `scenario_id` text NOT NULL,
  `group_id` text NOT NULL,
  `family` text NOT NULL,
  `members_json` text DEFAULT '[]' NOT NULL,
  `vehicle_types_json` text DEFAULT '{}' NOT NULL,
  `route_geometry_json` text DEFAULT '{}' NOT NULL,
  `sync_rules_json` text DEFAULT '{}' NOT NULL,
  `score_profile_json` text DEFAULT '{}' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gt_scenario_groups_scenario_group_uq` ON `gt_scenario_groups` (`scenario_id`,`group_id`);
--> statement-breakpoint
CREATE TABLE `ground_truth_labels` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `workspace_id` text NOT NULL,
  `scenario_id` text,
  `group_id` text NOT NULL,
  `layer` text NOT NULL,
  `score` integer NOT NULL,
  `quality` text,
  `start_utc` text,
  `end_utc` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_config_overrides` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `event_key` text NOT NULL,
  `group_id` text NOT NULL,
  `config_json` text DEFAULT '{}' NOT NULL,
  `reason` text NOT NULL,
  `approver` text,
  `approval_status` text DEFAULT 'draft' NOT NULL,
  `apply_mode` text DEFAULT 'now' NOT NULL,
  `config_version` integer,
  `algorithm_version` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `entity_type` text;
--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `entity_id` text;
--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `config_version` integer;
--> statement-breakpoint
ALTER TABLE `audit_entries` ADD `algorithm_version` text;
