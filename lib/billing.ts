import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { subscriptions, usageRecords, type Subscription } from "../db/schema";
import * as schema from "../db/schema";

/**
 * 订阅与内容额度（试点计费）。
 * 方案：免费试用 30 天 / 30 额度 → 人工开通专业版 ¥399/月 / 150 额度；
 * 支付确认由管理员在服务端完成（人工开通），为后续真实支付网关预留。
 */

export const TRIAL_CREDITS = 30;
export const TRIAL_DAYS = 30;
export const PRO_CREDITS_PER_MONTH = 150;
export const PRO_PRICE_CENTS = 39900; // ¥399.00/月

export type SubscriptionStatus = Subscription["status"];

export function getSubscriptionPlanLabel(plan: Subscription["plan"]): string {
  return plan === "pro" ? "专业版" : "免费试用";
}

export function getSubscriptionStatusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case "trialing":
      return "试用中";
    case "active":
      return "已开通";
    case "past_due":
      return "待续费";
    case "canceled":
      return "已停用";
    case "suspended":
      return "已暂停";
    default:
      return "未知";
  }
}

/** 工作区订阅；不存在时创建默认免费试用。 */
export async function getOrCreateSubscription(
  db: DrizzleD1Database<typeof schema>,
  workspaceId: string,
  now = new Date(),
): Promise<Subscription> {
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .get();
  if (existing) return existing;

  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const created: Subscription = {
    id: crypto.randomUUID(),
    workspaceId,
    plan: "free_trial",
    status: "trialing",
    creditsTotal: TRIAL_CREDITS,
    creditsUsed: 0,
    trialEndsAt,
    currentPeriodStartAt: now.toISOString(),
    currentPeriodEndAt: trialEndsAt,
    cancelAtPeriodEnd: false,
    activatedBy: null,
    activatedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await db.insert(subscriptions).values(created);
  return created;
}

export type CreditResult =
  | { ok: true; remaining: number; total: number; status: SubscriptionStatus }
  | { ok: false; code: "QUOTA_EXCEEDED" | "SUBSCRIPTION_INACTIVE"; message: string; status: SubscriptionStatus };

/** 检查并扣减额度；扣减成功后写入用量记录。 */
export async function consumeCredits(
  db: DrizzleD1Database<typeof schema>,
  workspaceId: string,
  kind: "content_generation" | "regenerate" | "asset_generation" | "export" | "connector_run",
  quantity = 1,
  meta: Record<string, unknown> = {},
): Promise<CreditResult> {
  const now = new Date();
  const sub = await getOrCreateSubscription(db, workspaceId, now);

  let current = sub;
  if (current.status === "trialing" && current.trialEndsAt && new Date(current.trialEndsAt).getTime() < now.getTime()) {
    current = { ...current, status: "canceled", updatedAt: now.toISOString() };
    await db
      .update(subscriptions)
      .set({ status: "canceled", updatedAt: now.toISOString() })
      .where(eq(subscriptions.id, current.id));
  } else if (current.status === "active" && current.currentPeriodEndAt && new Date(current.currentPeriodEndAt).getTime() < now.getTime()) {
    if (current.cancelAtPeriodEnd) {
      current = { ...current, status: "canceled", updatedAt: now.toISOString() };
      await db
        .update(subscriptions)
        .set({ status: "canceled", updatedAt: now.toISOString() })
        .where(eq(subscriptions.id, current.id));
    } else {
      const periodStart = now.toISOString();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      current = {
        ...current,
        creditsUsed: 0,
        currentPeriodStartAt: periodStart,
        currentPeriodEndAt: periodEnd,
        updatedAt: periodStart,
      };
      await db
        .update(subscriptions)
        .set({
          creditsUsed: 0,
          currentPeriodStartAt: periodStart,
          currentPeriodEndAt: periodEnd,
          updatedAt: periodStart,
        })
        .where(eq(subscriptions.id, current.id));
    }
  }

  if (current.status !== "active" && current.status !== "trialing") {
    return {
      ok: false,
      code: "SUBSCRIPTION_INACTIVE",
      message: "订阅未生效或已停用，请联系管理员开通。",
      status: current.status,
    };
  }

  if (current.creditsUsed + quantity > current.creditsTotal) {
    return {
      ok: false,
      code: "QUOTA_EXCEEDED",
      message: `本期内容额度已用完（${current.creditsUsed}/${current.creditsTotal}），请升级专业版。`,
      status: current.status,
    };
  }

  await db
    .update(subscriptions)
    .set({
      creditsUsed: current.creditsUsed + quantity,
      updatedAt: now.toISOString(),
    })
    .where(eq(subscriptions.id, current.id));

  await db.insert(usageRecords).values({
    id: crypto.randomUUID(),
    workspaceId,
    subscriptionId: current.id,
    kind,
    quantity,
    metaJson: JSON.stringify(meta),
  });

  return {
    ok: true,
    remaining: current.creditsTotal - current.creditsUsed - quantity,
    total: current.creditsTotal,
    status: current.status,
  };
}

export type PlanView = {
  plan: Subscription["plan"];
  planLabel: string;
  status: Subscription["status"];
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

export function toPlanView(sub: Subscription): PlanView {
  return {
    plan: sub.plan,
    planLabel: getSubscriptionPlanLabel(sub.plan),
    status: sub.status,
    statusLabel: getSubscriptionStatusLabel(sub.status),
    creditsTotal: sub.creditsTotal,
    creditsUsed: sub.creditsUsed,
    creditsRemaining: Math.max(0, sub.creditsTotal - sub.creditsUsed),
    trialEndsAt: sub.trialEndsAt,
    periodStartAt: sub.currentPeriodStartAt,
    periodEndAt: sub.currentPeriodEndAt,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    priceLabel: sub.plan === "pro" ? `¥${(PRO_PRICE_CENTS / 100).toFixed(2)}/月` : "试用期内免费",
  };
}
