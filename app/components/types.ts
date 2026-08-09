/**
 * 前端与服务端 API 共享的类型定义。
 * 服务端路由位于 app/api/ 下，字段以各路由实际返回为准。
 */

export type Risk = "low" | "medium" | "high" | "blocked";
export type Role = "admin" | "editor" | "approver" | "viewer";
export type PackageStatus = "draft" | "approved" | "exported" | "rejected";
export type TrendUserStatus = "none" | "watch" | "ignore" | "generate";
export type LicenseStatus = "authorized" | "customer_import" | "demo";

export type Session = {
  userId: string;
  email: string;
  name: string;
  isDemo: boolean;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  industry: string;
  ownerUserId: string;
  role?: Role;
};

export type ConsentState = {
  terms: { version: string; agreedAt: string } | null;
  privacy: { version: string; agreedAt: string } | null;
};

export type SessionPayload = {
  session: Session;
  workspaces: WorkspaceSummary[];
  legal: {
    requiredVersion: string;
    missing: string[];
    consents: ConsentState | null;
  };
  supportEmail: string | null;
  dbError: string | null;
  isGlobalAdmin: boolean;
};

export type RiskReason = { level: string; rule: string; matched: string };

export type Trend = {
  id: string;
  title: string;
  summary: string;
  category: string;
  risk: Risk;
  riskReasons: RiskReason[];
  score: number;
  scoreConfidence: "low" | "medium" | "high";
  breakdown: { label: string; value: number }[];
  change: number;
  sourceCount: number;
  sourceStatus: "authorized" | "customer_import" | "demo" | "unavailable";
  userStatus: TrendUserStatus;
  collectedAt: string;
  updatedAt: string;
};

export type TrendSource = {
  id: string;
  provider: string;
  sourceUrl: string;
  licenseStatus: LicenseStatus;
  collectedAt: string;
};

export type TrendDetailPayload = {
  trend: Trend;
  sources: TrendSource[];
};

export type GeneratedContent = {
  hooks: string[];
  script: string;
  caption: string;
  visual: string;
};

export type ContentPackageSummary = {
  id: string;
  trendId: string;
  trendTitle: string;
  trendRisk: Risk;
  status: PackageStatus;
  modelName: string;
  aiLabelStatus: "required" | "verified" | "missing";
  versionHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ContentPackageView = {
  id: string;
  trendId: string;
  trend: { title: string; summary: string; risk: Risk };
  status: PackageStatus;
  content: GeneratedContent;
  modelName: string;
  aiLabelStatus: "required" | "verified" | "missing";
  versionHash: string;
  placeholders: string[];
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PackageRevision = {
  version: number;
  editedBy: string;
  note: string | null;
  createdAt: string;
};

export type PackageDetailPayload = {
  package: ContentPackageView;
  sources: {
    provider: string;
    sourceUrl: string;
    licenseStatus: LicenseStatus;
    collectedAt: string;
  }[];
  revisions: PackageRevision[];
};

export type GeneratePayload = {
  contentPackage: ContentPackageView & {
    version: number;
    engine: string;
    demoEngine: boolean;
    disclaimer: string;
  };
  credits: { remaining: number; total: number };
};

export type AuditEvent = {
  id: string;
  contentPackageId: string | null;
  actorUserId: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type Connector = {
  id: string;
  name: string;
  kind: "http_api" | "csv";
  provider: string;
  enabled: boolean;
  status: string;
  lastRunAt: string | null;
  lastError: string | null;
  failureCount: number;
  backoffUntil: string | null;
  rateLimitResetAt: string | null;
  licenseNote: string;
  createdAt: string;
};

export type BrandProfile = {
  id: string;
  name: string;
  audience: string;
  tone: string;
  bannedTopics: string[];
  verifiedFacts: string[];
  version: number;
};

export type Member = {
  userId: string;
  role: Role;
  createdAt: string;
  invitedBy?: string;
};

export type SubscriptionView = {
  plan: "free_trial" | "pro";
  planLabel: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "suspended";
  statusLabel: string;
  creditsTotal: number;
  creditsUsed: number;
  creditsRemaining: number;
  trialEndsAt: string | null;
  periodStartAt: string | null;
  periodEndAt: string | null;
  cancelAtPeriodEnd: boolean;
  priceLabel: string;
};

export type BillingPayload = {
  subscription: SubscriptionView;
  usage: {
    id: string;
    kind: string;
    quantity: number;
    meta: Record<string, unknown>;
    createdAt: string;
  }[];
  invoices: {
    id: string;
    amountCents: number;
    currency: string;
    periodLabel: string;
    status: "pending" | "paid" | "voided";
    paidBy: string | null;
    paidAt: string | null;
    note: string | null;
    createdAt: string;
  }[];
  priceInfo: {
    currency: string;
    proPriceCents: number;
    proCreditsPerMonth: number;
    trialCredits: number;
  };
};

export type WorkspaceDetail = {
  workspace: { id: string; name: string; industry: string; ownerUserId: string };
  members: Member[];
  brandProfile: BrandProfile | null;
  connectors: Connector[];
  subscription: SubscriptionView;
};

export type ExportPayload = {
  manifest: Record<string, unknown>;
  exportedAt: string;
  credits: { remaining: number; total: number };
  notice: string;
};
