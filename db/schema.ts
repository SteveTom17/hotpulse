import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    industry: text("industry").notNull().default("local_food"),
    ownerUserId: text("owner_user_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_workspaces_owner_name").on(table.ownerUserId, table.name)],
);

export const brandProfiles = sqliteTable(
  "brand_profiles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    audience: text("audience").notNull().default(""),
    tone: text("tone").notNull().default("克制、真诚、清晰"),
    bannedTopicsJson: text("banned_topics_json").notNull().default("[]"),
    verifiedFactsJson: text("verified_facts_json").notNull().default("[]"),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_brand_profiles_workspace").on(table.workspaceId)],
);

export const trends = sqliteTable(
  "trends",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull().default(""),
    risk: text("risk", { enum: ["low", "medium", "high", "blocked"] }).notNull(),
    riskReasonsJson: text("risk_reasons_json").notNull().default("[]"),
    score: integer("score").notNull(),
    scoreConfidence: text("score_confidence", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    scoreBreakdownJson: text("score_breakdown_json").notNull(),
    change: integer("change").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    sourceStatus: text("source_status", { enum: ["authorized", "customer_import", "demo"] }).notNull(),
    userStatus: text("user_status", { enum: ["none", "watch", "ignore", "generate"] })
      .notNull()
      .default("none"),
    collectedAt: text("collected_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_trends_workspace_collected").on(table.workspaceId, table.collectedAt),
    index("idx_trends_workspace_risk").on(table.workspaceId, table.risk),
  ],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["admin", "editor", "approver", "viewer"] })
      .notNull()
      .default("viewer"),
    invitedBy: text("invited_by"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_members_workspace_user").on(table.workspaceId, table.userId),
    index("idx_members_user").on(table.userId),
  ],
);

export const connectors = sqliteTable(
  "connectors",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["http_api", "csv"] }).notNull(),
    provider: text("provider").notNull(),
    configJson: text("config_json").notNull().default("{}"),
    licenseNote: text("license_note").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status", { enum: ["idle", "syncing", "ok", "degraded", "error", "disabled"] })
      .notNull()
      .default("idle"),
    lastRunAt: text("last_run_at"),
    lastError: text("last_error"),
    failureCount: integer("failure_count").notNull().default(0),
    backoffUntil: text("backoff_until"),
    rateLimitResetAt: text("rate_limit_reset_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_connectors_workspace").on(table.workspaceId)],
);

export const trendImports = sqliteTable(
  "trend_imports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    sourceLabel: text("source_label").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    status: text("status", { enum: ["pending", "done", "partial", "failed"] }).notNull(),
    errorJson: text("error_json").notNull().default("[]"),
    importedBy: text("imported_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_trend_imports_workspace").on(table.workspaceId)],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    plan: text("plan", { enum: ["free_trial", "pro"] }).notNull().default("free_trial"),
    status: text("status", { enum: ["trialing", "active", "past_due", "canceled", "suspended"] })
      .notNull()
      .default("trialing"),
    creditsTotal: integer("credits_total").notNull().default(30),
    creditsUsed: integer("credits_used").notNull().default(0),
    trialEndsAt: text("trial_ends_at"),
    currentPeriodStartAt: text("current_period_start_at"),
    currentPeriodEndAt: text("current_period_end_at"),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
    activatedBy: text("activated_by"),
    activatedAt: text("activated_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_subscriptions_workspace").on(table.workspaceId)],
);

export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    kind: text("kind", {
      enum: ["content_generation", "regenerate", "asset_generation", "export", "connector_run"],
    }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    metaJson: text("meta_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_usage_workspace_created").on(table.workspaceId, table.createdAt)],
);

export const billingInvoices = sqliteTable(
  "billing_invoices",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("CNY"),
    periodLabel: text("period_label").notNull(),
    status: text("status", { enum: ["pending", "paid", "voided"] }).notNull().default("pending"),
    paidBy: text("paid_by"),
    paidAt: text("paid_at"),
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_invoices_workspace_status").on(table.workspaceId, table.status)],
);

export const legalConsents = sqliteTable(
  "legal_consents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    docType: text("doc_type", { enum: ["terms", "privacy"] }).notNull(),
    docVersion: text("doc_version").notNull(),
    agreedAt: text("agreed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("idx_consents_user_doc").on(table.userId, table.docType)],
);

export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    userId: text("user_id").notNull(),
    category: text("category", { enum: ["complaint", "appeal", "question", "data_request"] }).notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ["open", "processing", "closed"] }).notNull().default("open"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_tickets_user").on(table.userId)],
);

export const packageRevisions = sqliteTable(
  "package_revisions",
  {
    id: text("id").primaryKey(),
    contentPackageId: text("content_package_id")
      .notNull()
      .references(() => contentPackages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentJson: text("content_json").notNull(),
    editedBy: text("edited_by").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_revisions_package_version").on(table.contentPackageId, table.version),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Trend = typeof trends.$inferSelect;
export type TrendSource = typeof trendSources.$inferSelect;
export type Connector = typeof connectors.$inferSelect;
export type TrendImport = typeof trendImports.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type BillingInvoice = typeof billingInvoices.$inferSelect;
export type LegalConsent = typeof legalConsents.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type ContentPackage = typeof contentPackages.$inferSelect;
export type PackageRevision = typeof packageRevisions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type BrandProfile = typeof brandProfiles.$inferSelect;

export const trendSources = sqliteTable(
  "trend_sources",
  {
    id: text("id").primaryKey(),
    trendId: text("trend_id")
      .notNull()
      .references(() => trends.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    sourceUrl: text("source_url").notNull(),
    licenseStatus: text("license_status", { enum: ["authorized", "customer_import", "demo"] }).notNull(),
    collectedAt: text("collected_at").notNull(),
  },
  (table) => [index("idx_trend_sources_trend").on(table.trendId)],
);

export const contentPackages = sqliteTable(
  "content_packages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    trendId: text("trend_id")
      .notNull()
      .references(() => trends.id, { onDelete: "restrict" }),
    brandProfileId: text("brand_profile_id")
      .notNull()
      .references(() => brandProfiles.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["draft", "approved", "exported", "rejected"] })
      .notNull()
      .default("draft"),
    contentJson: text("content_json").notNull(),
    modelName: text("model_name").notNull(),
    aiLabelStatus: text("ai_label_status", { enum: ["required", "verified", "missing"] })
      .notNull()
      .default("required"),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    versionHash: text("version_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_content_packages_workspace_status").on(table.workspaceId, table.status),
    index("idx_content_packages_trend").on(table.trendId),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    // 审计留痕不随工作区删除：用户行使数据删除权时保留必要审计记录（宪章 §4），
    // 工作区删除后将 workspace_id 置空，事件本身保留。
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    contentPackageId: text("content_package_id").references(() => contentPackages.id, {
      onDelete: "set null",
    }),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_audit_events_workspace_created").on(table.workspaceId, table.createdAt),
    index("idx_audit_events_package_created").on(table.contentPackageId, table.createdAt),
  ],
);
