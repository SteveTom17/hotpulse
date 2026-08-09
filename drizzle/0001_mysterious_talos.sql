CREATE TABLE `billing_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subscription_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`period_label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_by` text,
	`paid_at` text,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_invoices_workspace_status` ON `billing_invoices` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`license_note` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_run_at` text,
	`last_error` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`backoff_until` text,
	`rate_limit_reset_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_connectors_workspace` ON `connectors` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `legal_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`doc_version` text NOT NULL,
	`agreed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_consents_user_doc` ON `legal_consents` (`user_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `package_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`content_package_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_json` text NOT NULL,
	`edited_by` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`content_package_id`) REFERENCES `content_packages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_revisions_package_version` ON `package_revisions` (`content_package_id`,`version`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`plan` text DEFAULT 'free_trial' NOT NULL,
	`status` text DEFAULT 'trialing' NOT NULL,
	`credits_total` integer DEFAULT 30 NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`trial_ends_at` text,
	`current_period_start_at` text,
	`current_period_end_at` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`activated_by` text,
	`activated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_workspace_id_unique` ON `subscriptions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_workspace` ON `subscriptions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tickets_user` ON `support_tickets` (`user_id`);--> statement-breakpoint
CREATE TABLE `trend_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`file_name` text NOT NULL,
	`source_label` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error_json` text DEFAULT '[]' NOT NULL,
	`imported_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trend_imports_workspace` ON `trend_imports` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subscription_id` text,
	`kind` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_usage_workspace_created` ON `usage_records` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`invited_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_workspace_user` ON `workspace_members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_members_user` ON `workspace_members` (`user_id`);--> statement-breakpoint
ALTER TABLE `trends` ADD `category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `trends` ADD `risk_reasons_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `trends` ADD `score_confidence` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `trends` ADD `change` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trends` ADD `source_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `trends` ADD `user_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `trends` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;