CREATE TABLE `core_checkpoints` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `workspace_id` text NOT NULL,
  `server_id` text NOT NULL,
  `core_api_version` text NOT NULL,
  `algorithm_version` text NOT NULL,
  `processed_until_utc` text,
  `checkpoint_base64` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_checkpoints_workspace_server_idx` ON `core_checkpoints` (`workspace_id`,`server_id`,`id`);
