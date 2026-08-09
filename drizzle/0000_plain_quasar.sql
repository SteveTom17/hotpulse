CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_package_id` text,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_package_id`) REFERENCES `content_packages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_workspace_created` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_package_created` ON `audit_events` (`content_package_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `brand_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`tone` text DEFAULT '克制、真诚、清晰' NOT NULL,
	`banned_topics_json` text DEFAULT '[]' NOT NULL,
	`verified_facts_json` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_brand_profiles_workspace` ON `brand_profiles` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `content_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`trend_id` text NOT NULL,
	`brand_profile_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_json` text NOT NULL,
	`model_name` text NOT NULL,
	`ai_label_status` text DEFAULT 'required' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`version_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trend_id`) REFERENCES `trends`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`brand_profile_id`) REFERENCES `brand_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_content_packages_workspace_status` ON `content_packages` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_content_packages_trend` ON `content_packages` (`trend_id`);--> statement-breakpoint
CREATE TABLE `trend_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`trend_id` text NOT NULL,
	`provider` text NOT NULL,
	`source_url` text NOT NULL,
	`license_status` text NOT NULL,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`trend_id`) REFERENCES `trends`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trend_sources_trend` ON `trend_sources` (`trend_id`);--> statement-breakpoint
CREATE TABLE `trends` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`risk` text NOT NULL,
	`score` integer NOT NULL,
	`score_breakdown_json` text NOT NULL,
	`source_status` text NOT NULL,
	`collected_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trends_workspace_collected` ON `trends` (`workspace_id`,`collected_at`);--> statement-breakpoint
CREATE INDEX `idx_trends_workspace_risk` ON `trends` (`workspace_id`,`risk`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`industry` text DEFAULT 'local_food' NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workspaces_owner_name` ON `workspaces` (`owner_user_id`,`name`);