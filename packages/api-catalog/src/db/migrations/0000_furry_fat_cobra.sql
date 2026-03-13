CREATE TABLE `api_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`api_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`summary` text,
	`description` text,
	`tags` text,
	`parameters` text,
	`request_body` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`api_id`) REFERENCES `apis`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `apis` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text NOT NULL,
	`subcategory` text,
	`base_url` text NOT NULL,
	`documentation_url` text,
	`openapi_spec_url` text,
	`auth_type` text DEFAULT 'none' NOT NULL,
	`free_tier` text,
	`rate_limits` text,
	`response_format` text,
	`http_methods` text,
	`status` text DEFAULT 'active' NOT NULL,
	`country_region` text,
	`pricing_url` text,
	`cors_support` text,
	`logo_url` text,
	`openapi_version` text,
	`api_version` text,
	`contact_url` text,
	`contact_email` text,
	`source` text,
	`has_spec` integer DEFAULT 0 NOT NULL,
	`spec_file` text,
	`endpoint_count` integer DEFAULT 0,
	`spec_format` text,
	`spec_parsed` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`api_id` text NOT NULL,
	`action` text NOT NULL,
	`synced_at` text,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	FOREIGN KEY (`api_id`) REFERENCES `apis`(`id`) ON UPDATE no action ON DELETE no action
);
